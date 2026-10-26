// Mirrors backend/app/schemas/registration.py: the backend is the source of truth, this is fast feedback.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRule {
  id: "length" | "upper" | "digit" | "special";
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", label: `Ít nhất ${PASSWORD_MIN_LENGTH} ký tự`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { id: "upper", label: "Ít nhất 1 chữ hoa", test: (p) => /\p{Lu}/u.test(p) },
  { id: "digit", label: "Ít nhất 1 chữ số", test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "Ít nhất 1 ký tự đặc biệt", test: (p) => /[^\p{L}\p{N}]/u.test(p) },
];

export const PASSWORD_PROBLEMS: Record<PasswordRule["id"], string> = {
  length: `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`,
  upper: "Mật khẩu phải có ít nhất 1 chữ hoa.",
  digit: "Mật khẩu phải có ít nhất 1 chữ số.",
  special: "Mật khẩu phải có ít nhất 1 ký tự đặc biệt.",
};

export function passwordProblems(password: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => PASSWORD_PROBLEMS[rule.id]);
}
