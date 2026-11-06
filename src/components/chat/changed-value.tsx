type Props = {
  initial: number;
  current: number;
  format: (n: number) => string;
};

// Shows a figure; once it differs from the one first shown, the old figure
// stays beside it, struck through.
export function ChangedValue({ initial, current, format }: Props) {
  if (initial === current) return <>{format(current)}</>;
  return (
    <>
      <s
        data-testid="changed-value-before"
        className="mr-1 font-normal text-muted-foreground"
      >
        {format(initial)}
      </s>{" "}
      <span data-testid="changed-value-after">{format(current)}</span>
    </>
  );
}
