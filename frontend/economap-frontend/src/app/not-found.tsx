import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-md rounded-2xl border border-white/70 bg-white/90 p-8 text-center shadow-lg backdrop-blur">
        <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-3 text-sm text-slate-600">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
