import { DiamondsFour } from "@phosphor-icons/react/dist/ssr";

type LoadingStateProps = {
  compact?: boolean;
  detail?: string;
  label: string;
  variant?: "dashboard" | "workspace";
};

export function LoadingState({
  compact = false,
  detail = "Securely syncing your latest data",
  label,
  variant = "workspace"
}: LoadingStateProps) {
  return (
    <section
      aria-busy="true"
      aria-label={label}
      className={`loading-state loading-state--${variant}${compact ? " loading-state--compact" : ""}`}
      role="status"
    >
      <div className="loading-state__header">
        <div className="loading-state__visual" aria-hidden="true">
          <span className="loading-state__orbit loading-state__orbit--outer" />
          <span className="loading-state__orbit loading-state__orbit--inner" />
          <DiamondsFour className="loading-state__mark" size={22} weight="fill" />
        </div>
        <div className="loading-state__copy">
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
        <span className="loading-state__signal" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>

      {compact ? null : (
        <div className={`loading-state__layout loading-state__layout--${variant}`} aria-hidden="true">
          <span className="loading-block loading-block--primary" />
          <span className="loading-block loading-block--secondary" />
          <span className="loading-block loading-block--wide" />
          <span className="loading-block loading-block--row" />
          <span className="loading-block loading-block--row loading-block--short" />
        </div>
      )}
    </section>
  );
}

export function ButtonBusy({ label }: { label: string }) {
  return (
    <span className="button-busy" role="status">
      <span className="button-busy__spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
