import Link from "next/link";

/** Attribution capability is independent of imported metadata and session totals. */
export function ReadingAttributionNotice() {
  return (
    <p className="mb-5 rounded-xl border bg-card p-4 text-sm leading-6 text-muted-foreground">
      Reading attribution is unavailable for sessions without an item link.
      Matter’s documented session data does not provide that link; syncing
      metadata cannot establish it. Stored item links are needed to identify an
      author, source, tag or article.{" "}
      <Link
        href="/articles"
        className="inline-flex min-h-11 items-center font-medium text-primary"
      >
        Browse current library metadata →
      </Link>
    </p>
  );
}
