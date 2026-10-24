import { isAxiosError } from "axios";

interface ValidationIssue {
  loc?: string[];
  msg?: string;
}

export function getApiFieldErrors(error: unknown) {
  if (!isAxiosError(error) || !Array.isArray(error.response?.data?.detail)) return {};
  const issues = error.response.data.detail as ValidationIssue[];
  return issues.reduce<Record<string, string>>((errors, issue) => {
    const field = issue.loc?.at(-1);
    if (field && issue.msg && !errors[field]) errors[field] = issue.msg;
    return errors;
  }, {});
}
