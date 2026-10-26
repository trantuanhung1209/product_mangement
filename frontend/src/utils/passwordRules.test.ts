import { describe, expect, it } from "vitest";

import cases from "./passwordCases.json";
import { passwordProblems } from "./passwordRules";

// passwordCases.json is also read by backend/tests/test_password_rules.py: one table, two implementations.
const CASES = (cases as { password: string; problems: number }[]).map((c) => [c.password, c.problems] as const);

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
