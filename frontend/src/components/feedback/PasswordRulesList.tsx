import { PASSWORD_RULES } from "../../utils/passwordRules";

export function PasswordRulesList({ password, id }: { password: string; id: string }) {
  return (
    <ul className="password-rules" id={id}>
      {PASSWORD_RULES.map((rule) => (
        <li key={rule.id} data-met={rule.test(password)}>
          {rule.test(password) ? "✓" : "•"} {rule.label}
        </li>
      ))}
    </ul>
  );
}
