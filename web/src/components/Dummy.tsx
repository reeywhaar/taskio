/**
 * A grey rectangle standing in for something that is not here yet.
 *
 * Shaped like what it is waiting for — a line the width of a name, a row the height of a row —
 * so the section does not change size when the answer arrives and push everything below it
 * down. Nothing inside it is real, so it is hidden from anything reading the page aloud: a
 * screen reader announcing six blank rectangles is worse than silence.
 */
export function Dummy({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`dummy rounded-md ${className}`} />;
}

/** The usual shape: a couple of lines where a sentence will be. */
export function DummyLines({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Dummy key={i} className={`h-4 ${i === count - 1 ? "w-40" : "w-64"}`} />
      ))}
    </div>
  );
}

/** A few rows where a list will be, at the height the rows actually are. */
export function DummyRows({
  count = 3,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <Dummy key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
