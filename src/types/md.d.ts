// Type declarations for importing .md files as text
declare module "*.md" {
  const content: string;
  export default content;
}
