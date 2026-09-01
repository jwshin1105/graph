# 함께 넣은 글꼴

수식은 세리프로 앉힌다는 디자인을 어느 컴퓨터에서나 똑같이 지키려고 글꼴을 함께 넣었다.
한글은 시스템 글꼴을 따른다 — 한글 글꼴은 파일이 커서 넣을 값어치가 없고,
어느 운영체제에나 쓸 만한 것이 이미 있다.

| 글꼴 | 하는 일 | 라이선스 |
| --- | --- | --- |
| Source Serif 4 (Regular · Italic · SemiBold) | 수식과 값의 기본 얼굴 | OFL — `OFL-SourceSerif4.txt` |
| STIX Two Text (Regular · Italic) | 그리스 문자와 ℤ ℕ ℚ ℝ ℂ, 위·아래 첨자 | OFL — `OFL-STIXTwo.txt` |
| DejaVu Serif | ∈ √ ≤ ⌊ ⌋ 처럼 앞의 둘에 없는 수학 기호 | Bitstream Vera 계열 허용 라이선스 |
| IBM Plex Mono (Regular · Medium) | 자릿수·오차처럼 자리를 맞춰야 하는 수 | OFL — `OFL.txt` |

세 세리프를 이 차례로 이어 두면 (`QFont.setFamilies`) 앞의 것에 없는 글자만
뒤의 것이 그린다. 셋을 합쳐 못 그리는 것은 `∖` 하나뿐이고, 그건 어느 운영체제에나
있는 기호라 시스템 글꼴이 대신 그린다.
