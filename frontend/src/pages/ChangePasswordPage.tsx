import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { getApiFieldErrors } from "../api/errors";
import { PasswordInput } from "../components/feedback/PasswordInput";
import { PasswordRulesList } from "../components/feedback/PasswordRulesList";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useChangePassword } from "../hooks/usePasswordMutations";
import { describeError } from "../utils/authErrors";
import { passwordProblems } from "../utils/passwordRules";

export function ChangePasswordPage() {
  useDocumentTitle("Đổi mật khẩu");
  const navigate = useNavigate();
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    const errors: Record<string, string> = {};
    const problems = passwordProblems(password);
    if (problems.length) errors.password = problems[0];
    else if (password === current) errors.password = "Mật khẩu mới phải khác mật khẩu hiện tại.";
    if (confirmation !== password) errors.confirmation = "Mật khẩu xác nhận không khớp.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    change.mutate(
      { currentPassword: current, newPassword: password },
      {
        onSuccess: () =>
          // The server ended every session; the hook has already cleared the client session.
          navigate("/login", { replace: true, state: { notice: "Đã đổi mật khẩu. Vui lòng đăng nhập lại." } }),
        onError: (error) => {
          const apiErrors = getApiFieldErrors(error);
          if (apiErrors.new_password) setFieldErrors({ password: apiErrors.new_password });
          else setFormError(describeError(error));
        },
      },
    );
  };

  return (
    <section className="page-section">
      <form className="login-card" onSubmit={submit} noValidate>
        <h1>Đổi mật khẩu</h1>
        <p>Sau khi đổi, mọi phiên đăng nhập (kể cả phiên này) sẽ bị đăng xuất.</p>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <PasswordInput label="Mật khẩu hiện tại" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
        <PasswordInput
          label="Mật khẩu mới"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={fieldErrors.password}
          describedBy="change-password-rules"
        />
        <PasswordRulesList password={password} id="change-password-rules" />
        <PasswordInput
          label="Xác nhận mật khẩu mới"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          error={fieldErrors.confirmation}
        />
        <button className="primary-button login-submit" disabled={change.isPending}>
          {change.isPending ? "Đang đổi..." : "Đổi mật khẩu"}
        </button>
      </form>
    </section>
  );
}
