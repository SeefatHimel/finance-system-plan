export function FieldError({ field, errors, prefix = "transaction" }: { field: string; errors: Record<string, string>; prefix?: string }) {
  return errors[field] ? <small className="field-error" id={`${prefix}-error-${field}`}>{errors[field]}</small> : null;
}
