export type RegistrationFormValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  code: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRegistrationEmail(value: string) {
  return value.trim().toLowerCase();
}

export function sanitizeVerificationCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function validateLoginSubmission(email: string, password: string) {
  const normalizedEmail = normalizeRegistrationEmail(email);
  if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 320) {
    return "请输入有效邮箱";
  }
  if (password.length < 8) return "密码至少需要 8 位";
  if (password.length > 128) return "密码不能超过 128 位";
  return null;
}

export function validateRegistrationSubmission(values: RegistrationFormValues) {
  const trimmedName = values.name.trim();
  if (trimmedName.length < 2) return "昵称至少需要 2 个字符";
  if (trimmedName.length > 40) return "昵称不能超过 40 个字符";

  const credentialsError = validateLoginSubmission(
    values.email,
    values.password
  );
  if (credentialsError) return credentialsError;
  if (values.password !== values.confirmPassword) {
    return "两次输入的密码不一致";
  }
  if (!/^\d{6}$/.test(values.code)) return "请输入 6 位邮箱验证码";
  return null;
}
