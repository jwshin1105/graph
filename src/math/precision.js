// 계산 정밀도 설정.
//
// 내부 계산과 화면 표시를 나눈다. 표시하려고 반올림한 값이 다음 계산에 흘러들어
// 오차가 쌓이는 일을 막기 위해서다. 화면에 12자리를 보여 주더라도 안에서는
// 30자리로 계산하고, 그 값을 그대로 다음 계산에 넘긴다.

const state = {
  internal: 30,   // 내부 계산 유효숫자
  display: 12,    // 화면 표시 유효숫자
};

export function getPrecision() { return { ...state }; }

/**
 * @param {{internal?:number, display?:number}} next
 */
export function setPrecision(next = {}) {
  if (Number.isFinite(next.internal)) {
    state.internal = Math.max(6, Math.min(1000, Math.round(next.internal)));
  }
  if (Number.isFinite(next.display)) {
    state.display = Math.max(3, Math.min(state.internal, Math.round(next.display)));
  }
  // 표시가 내부보다 정밀할 수는 없다
  if (state.display > state.internal) state.display = state.internal;
  return getPrecision();
}

export const internalDigits = () => state.internal;
export const displayDigits = () => state.display;
