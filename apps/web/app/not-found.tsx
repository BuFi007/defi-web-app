import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-content-center bg-background px-4">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          404
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          Page not found
        </h1>
        <p className="mt-4 max-w-md text-lg text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-10 items-center justify-center rounded-md border border-yellow-200 px-8 text-sm font-medium transition-colors hover:bg-yellow-300 hover:text-black focus:outline-none focus:ring"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
