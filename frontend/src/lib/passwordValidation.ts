export interface PasswordRequirement {
  id: string;
  label: string;
  met: boolean;
}

export function checkPasswordStrength(password: string) {
  const p = password || "";
  const hasMinLength = p.length >= 8;
  const hasUppercase = /[A-Z]/.test(p);
  const hasNumber = /[0-9]/.test(p);
  const hasSpecial = /[^A-Za-z0-9]/.test(p);

  const requirements: PasswordRequirement[] = [
    { id: "length", label: "At least 8 characters", met: hasMinLength },
    { id: "uppercase", label: "At least 1 uppercase letter (A-Z)", met: hasUppercase },
    { id: "number", label: "At least 1 number (0-9)", met: hasNumber },
    { id: "special", label: "At least 1 special character (!@#$%^&*)", met: hasSpecial },
  ];

  const isValid = hasMinLength && hasUppercase && hasNumber && hasSpecial;
  const metCount = requirements.filter((r) => r.met).length;

  return {
    isValid,
    metCount,
    requirements,
  };
}

export function getPasswordValidationError(password: string): string | null {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter (A-Z).";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number (0-9).";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must contain at least one special character (e.g. !@#$%^&*).";
  }
  return null;
}

