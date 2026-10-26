import { describe, expect, it } from "vitest";

import { passwordProblems } from "./passwordRules";

// The same table is asserted by backend/tests/test_registration.py; keep the two in step.
const CASES: [string, number][] = [
  ["Abcdef1!", 0],
  ["Mật-khẩu-Tốt-1", 0],
  ["Mật khẩu 1A", 0],
  ["Đẹp-1xyz", 0], // a non-ASCII capital counts as upper case
  ["P@ssw0rd" + "x".repeat(120), 0],
  ["Sh0rt!", 1],
  ["lowercase1!", 1],
  ["NoDigitsHere!", 1],
  ["NoSpecial123", 1],
  ["", 4],
];

describe("passwordProblems", () => {
  it.each(CASES)("%j has %i problem(s)", (password, count) => {
    expect(passwordProblems(password)).toHaveLength(count);
  });

  it("names the missing rule in Vietnamese", () => {
    expect(passwordProblems("lowercase1!")).toEqual(["Mật khẩu phải có ít nhất 1 chữ hoa."]);
    expect(passwordProblems("NoDigitsHere!")).toEqual(["Mật khẩu phải có ít nhất 1 chữ số."]);
    expect(passwordProblems("NoSpecial123")).toEqual(["Mật khẩu phải có ít nhất 1 ký tự đặc biệt."]);
    expect(passwordProblems("Sh0rt!")).toEqual(["Mật khẩu phải có ít nhất 8 ký tự."]);
  });
});
