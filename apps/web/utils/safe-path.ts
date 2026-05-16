export const getSafePath = (value: string | null) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  if (value === "/alpha" || value.startsWith("/alpha?")) {
    return "/";
  }

  return value;
};
