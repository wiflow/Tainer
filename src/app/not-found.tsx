import { ErrorState } from "@/components/error-state";

export default function NotFound() {
  return (
    <ErrorState
      backHref="/"
      description="The page you're looking for doesn't exist. A site or deployment referenced by an old link may also have been removed."
      title="Page not found"
    />
  );
}
