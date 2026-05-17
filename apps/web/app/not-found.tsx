import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div className="flex flex-col items-center justify-center gap-6">
        <h1 className="font-black leading-none tracking-tight text-purpleDanis text-[clamp(7rem,22vw,18rem)]">
          404
        </h1>
        <p className="text-2xl sm:text-3xl font-semibold text-purpleDanis">
          Oops <span aria-hidden>👻🕸️</span>
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex h-11 items-center justify-center rounded-full border-2 border-purpleDanis px-8 text-sm font-bold uppercase tracking-wide text-purpleDanis transition-colors hover:bg-purpleDanis hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-purpleDanis/40"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
