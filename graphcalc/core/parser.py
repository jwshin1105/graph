"""파서 — 사람이 적는 수식을 SymPy 식과 문장으로 옮긴다.

직접 만든 이유는 두 가지다.

1. **리터럴을 정확하게 남긴다.** `0.1` 을 부동소수 0.1 로 읽으면 그 순간
   1/10 이 아니게 된다. 여기서는 Rational(1, 10) 으로 읽어 둔다.
   그래서 `0.1 + 0.2` 가 3/10 으로 나온다.
2. **수학 표기를 그대로 받는다.** 암묵 곱(2x, xy), 함수 적용(sin 2x),
   아래첨자(a_n, a_{n+1}), 절댓값(|x|), 위첨자(x²), 소속(n ∈ ℤ) 같은 것들은
   SymPy 의 sympify 로는 제대로 읽히지 않는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import sympy
from sympy import Rational, Symbol

from .syntax import Bare, Definition, DomainDecl, ListExpr, ParseError, Relation, Setting

# ─────────────────────────────────────────────────────────── 이름표

FUNCS = {
    "sin", "cos", "tan", "sec", "csc", "cot",
    "asin", "acos", "atan", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
    "exp", "ln", "log", "sqrt", "cbrt", "abs", "sign",
    "floor", "ceil", "round", "gcd", "lcm", "mod", "max", "min",
    "gamma", "factorial", "binom", "atan2", "conj", "re", "im", "arg",
}

CONSTS = {
    "pi": sympy.pi, "π": sympy.pi, "τ": 2 * sympy.pi, "tau": 2 * sympy.pi,
    "e": sympy.E, "i": sympy.I, "∞": sympy.oo, "inf": sympy.oo, "oo": sympy.oo,
    "φ": (1 + sympy.sqrt(5)) / 2, "phi": (1 + sympy.sqrt(5)) / 2,
}

DOMAINS = {
    "ℤ": sympy.S.Integers, "Z": sympy.S.Integers, "int": sympy.S.Integers,
    "ℕ": sympy.S.Naturals, "N": sympy.S.Naturals,
    "ℕ0": sympy.S.Naturals0, "N0": sympy.S.Naturals0,
    "ℚ": sympy.S.Rationals, "Q": sympy.S.Rationals,
    "ℝ": sympy.S.Reals, "R": sympy.S.Reals,
    "ℂ": sympy.S.Complexes, "C": sympy.S.Complexes,
}

SETTINGS = {"precision", "digits", "epsilon", "정밀도", "자릿수", "오차"}

SUPERS = {"⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
          "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-"}

GREEK = "αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΘΛΞΠΣΦΨΩ"

# 눈에 익은 기호를 아스키로 미리 바꾼다
NORMALIZE = {
    "−": "-", "–": "-", "—": "-", "×": "*", "·": "*", "÷": "/",
    "≤": "<=", "≦": "<=", "≥": ">=", "≧": ">=", "≠": "!=", "＝": "=",
    "（": "(", "）": ")", "，": ",", "’": "'", "′": "'", "√": "sqrt",
    "∈": " ∈ ", "⁢": " ", " ": " ",
}


@dataclass
class Token:
    kind: str      # num name op ( ) [ ] { } , | end
    text: str
    pos: int
    value: object = None


NUM_RE = re.compile(r"\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?")
NAME_RE = re.compile(rf"[A-Za-z_{GREEK}ℤℕℚℝℂ][A-Za-z0-9_{GREEK}]*")


def exact_number(text: str):
    """리터럴을 **정확한 유리수**로. 0.1 은 1/10 이지 0.1000000000000000055 가 아니다."""
    if "e" in text or "E" in text:
        mant, _, ex = re.split(r"[eE]", text.strip())[0], "e", re.split(r"[eE]", text.strip())[1]
        return exact_number(mant) * Rational(10) ** int(ex)
    if "." in text:
        whole, frac = text.split(".", 1)
        frac = frac or "0"
        return Rational(int(whole or 0) * 10 ** len(frac) + int(frac), 10 ** len(frac))
    return sympy.Integer(int(text))


def tokenize(src: str) -> list[Token]:
    s = src
    for k, v in NORMALIZE.items():
        s = s.replace(k, v)
    # 위첨자는 ^(…) 로 편다:  x² → x^(2)
    out_chars = []
    i = 0
    while i < len(s):
        if s[i] in SUPERS:
            j = i
            buf = ""
            while j < len(s) and s[j] in SUPERS:
                buf += SUPERS[s[j]]
                j += 1
            out_chars.append(f"^({buf})")
            i = j
        else:
            out_chars.append(s[i])
            i += 1
    s = "".join(out_chars)

    toks: list[Token] = []
    i = 0
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
            continue
        m = NUM_RE.match(s, i)
        if m and c.isdigit() or (c == "." and m):
            toks.append(Token("num", m.group(), i, exact_number(m.group())))
            i = m.end()
            continue
        m = NAME_RE.match(s, i)
        if m:
            word = m.group()
            # a_n, a_1 은 이름 a 에 아래첨자 n, 1 이 붙은 것이다.
            # 밑줄에서 잘라 아래첨자로 넘겨야 a(n), a(1) 로 읽힌다.
            head, sep, _tail = word.partition("_")
            if sep and head:
                toks.append(Token("name", head, i))
                toks.append(Token("op", "_", i + len(head)))
                i += len(head) + 1
                continue
            toks.append(Token("name", word, i))
            i = m.end()
            continue
        two = s[i:i + 2]
        if two in ("<=", ">=", "!=", "==", "->", "=>"):
            toks.append(Token("op", "=" if two == "==" else two, i))
            i += 2
            continue
        if c in "+-*/^=<>!":
            toks.append(Token("op", c, i))
            i += 1
            continue
        if c in "()[]{},|;":
            toks.append(Token(c, c, i))
            i += 1
            continue
        if c == "∈":
            toks.append(Token("op", "∈", i))
            i += 1
            continue
        if c == "'":
            toks.append(Token("op", "'", i))
            i += 1
            continue
        raise ParseError(f"모르는 글자 '{c}'", i)
    toks.append(Token("end", "", len(s)))
    return toks


class Parser:
    def __init__(self, toks: list[Token], names: set[str] | None = None):
        self.toks = toks
        self.i = 0
        self.bar = 0            # |…| 안쪽인가
        # 사용자가 정의한 이름 — f(x)=… 을 적었으면 f 를 함수로 본다
        self.user = names or set()

    # ── 토큰 다루기
    @property
    def cur(self) -> Token:
        return self.toks[self.i]

    def at(self, kind: str, text: str | None = None) -> bool:
        t = self.cur
        return t.kind == kind and (text is None or t.text == text)

    def eat(self, kind: str, text: str | None = None) -> Token | None:
        if self.at(kind, text):
            t = self.cur
            self.i += 1
            return t
        return None

    def expect(self, kind: str, text: str | None = None) -> Token:
        t = self.eat(kind, text)
        if t is None:
            raise ParseError(f"'{text or kind}' 가 있어야 합니다", self.cur.pos)
        return t

    # ── 식
    def expr(self):
        return self.additive()

    def additive(self):
        node = self.multiplicative()
        while self.cur.kind == "op" and self.cur.text in "+-":
            op = self.cur.text
            self.i += 1
            rhs = self.multiplicative()
            node = node + rhs if op == "+" else node - rhs
        return node

    def multiplicative(self):
        node = self.unary()
        while True:
            if self.cur.kind == "op" and self.cur.text in "*/":
                op = self.cur.text
                self.i += 1
                rhs = self.unary()
                node = node * rhs if op == "*" else node / rhs
            elif self.starts_factor():
                node = node * self.unary()      # 암묵 곱: 2x, xy, 2 sin x
            else:
                return node

    def starts_factor(self) -> bool:
        """다음 토큰이 곱해질 수 있는 것으로 시작하는가."""
        t = self.cur
        if t.kind == "|":
            # 막대 안에서는 닫는 막대이지, 새 인자의 시작이 아니다
            return self.bar == 0
        return t.kind in ("num", "name", "(", "[")

    def unary(self):
        if self.cur.kind == "op" and self.cur.text == "-":
            self.i += 1
            return -self.unary()
        if self.cur.kind == "op" and self.cur.text == "+":
            self.i += 1
            return self.unary()
        return self.power()

    def power(self):
        base = self.postfix()
        if self.cur.kind == "op" and self.cur.text == "^":
            self.i += 1
            exp = self.unary()          # 우결합, -x 도 지수로
            # (1 + 10⁻⁶)^(10⁶) 을 여기서 펴 버리면 자릿수가 수백만인 유리수가 된다.
            # 계산 층이 "정확히 vs 고정밀" 을 고를 수 있도록 모양 그대로 넘긴다.
            if exp.is_Integer and abs(int(exp)) > 2000 and base.is_Rational:
                return sympy.Pow(base, exp, evaluate=False)
            return base ** exp
        return base

    def postfix(self):
        node = self.atom()
        while True:
            if self.cur.kind == "op" and self.cur.text == "!":
                self.i += 1
                node = sympy.factorial(node)
            else:
                return node

    # ── 원자
    def atom(self):
        t = self.cur
        if t.kind == "num":
            self.i += 1
            return t.value
        if t.kind == "(":
            self.i += 1
            items = [self.expr()]
            while self.eat(","):
                items.append(self.expr())
            self.expect(")")
            return items[0] if len(items) == 1 else sympy.Tuple(*items)
        if t.kind == "[":
            self.i += 1
            items = []
            if not self.at("]"):
                items.append(self.expr())
                while self.eat(","):
                    items.append(self.expr())
            self.expect("]")
            return ListExpr(*items)
        if t.kind == "{":
            self.i += 1
            items = []
            if not self.at("}"):
                items.append(self.expr())
                while self.eat(","):
                    items.append(self.expr())
            self.expect("}")
            return sympy.FiniteSet(*items)
        if t.kind == "|":
            self.i += 1
            self.bar += 1
            try:
                inner = self.expr()
            finally:
                self.bar -= 1
            self.expect("|")
            return sympy.Abs(inner)
        if t.kind == "name":
            return self.name_atom()
        raise ParseError("식이 와야 합니다", t.pos)

    def name_atom(self):
        t = self.expect("name")
        name = t.text
        if name in DOMAINS and not self.at("("):
            return DOMAINS[name]
        # 아래첨자 — a_n, a_{n+1}, a_1  →  a(n), a(n+1), a(1)
        if self.at("op", "_") or name.endswith("_"):
            pass
        sub = self.subscript()
        if sub is not None:
            return sympy.Function(name.rstrip("_"))(sub)
        if name in CONSTS and not self.at("("):
            return CONSTS[name]
        if name in FUNCS or name in self.user:
            return self.apply(name)
        return Symbol(name)

    def subscript(self):
        """이름 뒤에 붙은 _n, _{n+1} 을 읽는다. 없으면 None."""
        if not (self.cur.kind == "op" and self.cur.text == "_"):
            # NAME_RE 가 a_n 을 통째로 먹었을 수도 있다 — 그건 name_atom 앞에서 처리
            return None
        self.i += 1
        if self.eat("{"):
            e = self.expr()
            self.expect("}")
            return e
        t = self.cur
        if t.kind == "num":
            self.i += 1
            return t.value
        if t.kind == "name":
            self.i += 1
            return Symbol(t.text)
        raise ParseError("아래첨자가 있어야 합니다", t.pos)

    def apply(self, name: str):
        """함수 적용. sin(x), sin x, sin 2x, sin^2 x 를 모두 받는다."""
        power = None
        if self.cur.kind == "op" and self.cur.text == "^":
            self.i += 1
            power = self.unary()
        if self.at("("):
            self.i += 1
            args = []
            if not self.at(")"):
                args.append(self.expr())
                while self.eat(","):
                    args.append(self.expr())
            self.expect(")")
        else:
            args = [self.func_arg()]
        node = make_call(name, args, self.user)
        return node ** power if power is not None else node

    def func_arg(self):
        """괄호 없는 인자. `sin 2x` 는 sin(2x) 지만 `sin x cos x` 는 sin(x)·cos(x) 다.

        그래서 **다른 함수 이름을 만나면 멈춘다.**
        """
        node = self.unary()
        while self.starts_factor():
            t = self.cur
            if t.kind == "name" and (t.text in FUNCS or t.text in self.user):
                break
            node = node * self.unary()
        return node


def make_call(name: str, args: list, user: set[str] | None = None):
    a = args[0] if args else None
    table = {
        "sin": sympy.sin, "cos": sympy.cos, "tan": sympy.tan,
        "sec": sympy.sec, "csc": sympy.csc, "cot": sympy.cot,
        "asin": sympy.asin, "acos": sympy.acos, "atan": sympy.atan,
        "arcsin": sympy.asin, "arccos": sympy.acos, "arctan": sympy.atan,
        "sinh": sympy.sinh, "cosh": sympy.cosh, "tanh": sympy.tanh,
        "asinh": sympy.asinh, "acosh": sympy.acosh, "atanh": sympy.atanh,
        "exp": sympy.exp, "ln": sympy.log, "sqrt": sympy.sqrt,
        "abs": sympy.Abs, "sign": sympy.sign, "floor": sympy.floor,
        "ceil": sympy.ceiling, "gamma": sympy.gamma, "factorial": sympy.factorial,
        "conj": sympy.conjugate, "re": sympy.re, "im": sympy.im, "arg": sympy.arg,
    }
    if name in table:
        return table[name](*args)
    if name == "log":
        return sympy.log(*args[::-1]) if len(args) == 2 else sympy.log(a, 10)
    if name == "cbrt":
        return sympy.real_root(a, 3)
    if name == "round":
        return sympy.floor(a + Rational(1, 2))
    if name == "mod":
        return sympy.Mod(*args)
    if name in ("gcd", "lcm"):
        f = sympy.gcd if name == "gcd" else sympy.lcm
        out = args[0]
        for x in args[1:]:
            out = f(out, x)
        return out
    if name == "max":
        return sympy.Max(*args)
    if name == "min":
        return sympy.Min(*args)
    if name == "binom":
        return sympy.binomial(*args)
    if name == "atan2":
        return sympy.atan2(*args)
    return sympy.Function(name)(*args)


# ────────────────────────────────────────────────── 문장

REL_OPS = {"=", "<", ">", "<=", ">=", "!=", "∈"}


def split_top(toks: list[Token], sep: str) -> list[list[Token]]:
    """괄호 밖의 sep 으로 토큰을 자른다."""
    depth = 0
    out: list[list[Token]] = [[]]
    for t in toks:
        if t.kind in "([{":
            depth += 1
        elif t.kind in ")]}":
            depth -= 1
        if depth == 0 and t.kind == sep:
            out.append([])
            continue
        out[-1].append(t)
    return out


def parse(src: str, names: set[str] | None = None):
    """한 줄을 문장으로."""
    text = src.strip()
    if not text or text.startswith("#"):
        return None
    toks = tokenize(text)[:-1]
    if not toks:
        return None
    parts = split_top(toks, ",")
    # 뒤에 붙은 절이 정의역·조건이면 떼어 낸다.  (n, n^2) 처럼 점이면 자르면 안 된다
    main, clauses = parts[0], parts[1:]
    if clauses and not is_clause_list(clauses):
        main, clauses = toks, []
    stmt = parse_one(main + [Token("end", "", len(text))], names)
    stmt.text = text
    for c in clauses:
        sub = parse_one(c + [Token("end", "", len(text))], names)
        if isinstance(sub, DomainDecl):
            stmt.domains[sub.var] = sub.domain
        elif isinstance(sub, Relation):
            stmt.conditions.append(relation_expr(sub))
        elif isinstance(sub, Bare):
            stmt.conditions.append(sub.body)
    return stmt


def is_clause_list(clauses: list[list[Token]]) -> bool:
    """뒤 절이 전부 조건·정의역인가 (점 (a, b) 와 가르려고)."""
    for c in clauses:
        if not any(t.kind == "op" and t.text in REL_OPS for t in c):
            return False
    return True


def relation_expr(r: Relation):
    ops = {"=": sympy.Eq, "<": sympy.Lt, ">": sympy.Gt,
           "<=": sympy.Le, ">=": sympy.Ge, "!=": sympy.Ne}
    if r.op == "∈":
        return sympy.Contains(r.lhs, r.rhs)
    return ops[r.op](r.lhs, r.rhs)


def parse_one(toks: list[Token], names: set[str] | None):
    # 관계 연산자를 괄호 밖에서 찾는다
    depth = 0
    cut = -1
    for k, t in enumerate(toks):
        if t.kind in "([{":
            depth += 1
        elif t.kind in ")]}":
            depth -= 1
        elif depth == 0 and t.kind == "op" and t.text in REL_OPS:
            cut = k
            break
    if cut < 0:
        p = Parser(toks, names)
        body = p.expr()
        if p.cur.kind != "end":
            raise ParseError("식을 다 읽지 못했습니다", p.cur.pos)
        return Bare(body=body)

    op = toks[cut].text
    left = toks[:cut] + [Token("end", "", toks[cut].pos)]
    right = toks[cut + 1:]

    # n ∈ ℤ
    if op == "∈":
        lp = Parser(left, names)
        lhs = lp.expr()
        rp = Parser(right, names)
        rhs = rp.expr()
        if isinstance(lhs, Symbol):
            return DomainDecl(var=lhs.name, domain=rhs)
        return Relation(op="∈", lhs=lhs, rhs=rhs)

    rp = Parser(right, names)
    rhs = rp.expr()
    if rp.cur.kind != "end":
        raise ParseError("오른쪽 식을 다 읽지 못했습니다", rp.cur.pos)

    if op == "=":
        # 설정:  precision = 60
        if len(left) == 2 and left[0].kind == "name" and left[0].text in SETTINGS:
            return Setting(name=left[0].text, value=rhs)
        d = as_definition(left, rhs, names)
        if d is not None:
            return d

    lp = Parser(left, names)
    lhs = lp.expr()
    if lp.cur.kind != "end":
        raise ParseError("왼쪽 식을 다 읽지 못했습니다", lp.cur.pos)
    return Relation(op=op, lhs=lhs, rhs=rhs)


def as_definition(left: list[Token], rhs, names) -> Definition | None:
    """왼쪽이 y, f(x), a_n, P(n) 같은 '정의할 이름' 인가."""
    if not left or left[0].kind != "name":
        return None
    name = left[0].text
    rest = left[1:-1]                      # end 토큰 제외
    if not rest:
        if name in DOMAINS or name in CONSTS:
            return None
        return Definition(name=name, params=(), body=rhs)
    # a_n = …  /  a_{n+1} = …
    if rest[0].kind == "op" and rest[0].text == "_":
        p = Parser(left, names)
        node = p.expr()
        if p.cur.kind == "end" and isinstance(node, sympy.core.function.AppliedUndef):
            return Definition(name=node.func.__name__, params=tuple(node.args),
                              body=rhs, subscript=True)
        return None
    # f(x) = …  /  P(n) = (…, …)
    if rest[0].kind == "(" and rest[-1].kind == ")":
        inner = rest[1:-1]
        params = []
        for chunk in split_top(inner, ","):
            if len(chunk) == 1 and chunk[0].kind == "name":
                params.append(Symbol(chunk[0].text))
            else:
                return None
        if not params:
            return None
        return Definition(name=name, params=tuple(params), body=rhs)
    return None


def parse_all(lines, names: set[str] | None = None):
    """여러 줄. 앞 줄에서 정의한 이름을 뒷 줄이 함수로 알아본다."""
    known = set(names or ())
    out = []
    for line in lines:
        try:
            st = parse(line, known)
        except ParseError as e:
            out.append(e)
            continue
        if st is None:
            out.append(None)
            continue
        if isinstance(st, Definition) and st.params:
            known.add(st.name)
        out.append(st)
    return out
