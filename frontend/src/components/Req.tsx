// Mandatory fields get a red asterisk next to the label; non-mandatory ones
// simply carry no mark (no "(optional)" text needed once that's the rule).
// Shared between RegisterPage.tsx and LineItemsGrid.tsx -- same convention,
// one definition.
export function Req() {
  return <span className="required-mark">*</span>;
}
