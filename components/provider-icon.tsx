import type { AuthProviderId } from "@/lib/auth-providers";

type ProviderIconProps = {
  id: AuthProviderId;
};

export function ProviderIcon({ id }: ProviderIconProps) {
  switch (id) {
    case "email":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            fill="currentColor"
            d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5L4 8V6l8 5 8-5v2Z"
          />
        </svg>
      );
    case "google":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            fill="#4285F4"
            d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.56-5.16 3.56-8.65Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.87-3c-1.08.72-2.46 1.15-4.08 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.37l4.01-3.09Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.14 15.23 0 12 0A12 12 0 0 0 1.26 6.63l4.01 3.09C6.22 6.88 8.87 4.77 12 4.77Z"
          />
        </svg>
      );
    case "gitlab":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path fill="#E24329" d="m12 22.5 4.2-12.9H7.8L12 22.5Z" />
          <path fill="#FC6D26" d="M12 22.5 7.8 9.6H2.4L12 22.5Z" />
          <path
            fill="#FCA326"
            d="M2.4 9.6 1.1 13.6a1.05 1.05 0 0 0 .38 1.18L12 22.5 2.4 9.6Z"
          />
          <path fill="#E24329" d="M2.4 9.6h5.4L5.7 3.4a.53.53 0 0 0-1 .02L2.4 9.6Z" />
          <path fill="#FC6D26" d="M12 22.5 16.2 9.6h5.4L12 22.5Z" />
          <path
            fill="#FCA326"
            d="m21.6 9.6 1.3 4a1.05 1.05 0 0 1-.38 1.18L12 22.5l9.6-12.9Z"
          />
          <path fill="#E24329" d="M21.6 9.6h-5.4l2.1-6.2a.53.53 0 0 1 1-.02l2.3 6.22Z" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            fill="currentColor"
            d="M12 .5C5.73.5.5 5.73.5 12.02c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.53-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.19a11.1 11.1 0 0 1 5.8 0c2.2-1.5 3.17-1.19 3.17-1.19.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z"
          />
        </svg>
      );
    case "bitbucket":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            fill="#2684FF"
            d="M2.3 3.2a.7.7 0 0 0-.7.8l2.6 15.8a.95.95 0 0 0 .93.78h14.9a.7.7 0 0 0 .7-.58l2.6-16a.7.7 0 0 0-.7-.8H2.3Zm12.4 10.5H9.4l-1-5.3h7.3l-1 5.3Z"
          />
        </svg>
      );
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}
