import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileBrowser,
  FileBrowserAdapterError,
  FileBrowserProvider,
  type FileBrowserAdapter,
  type FileBrowserProps,
  type FileNode,
} from "react-file-browser";
import { InMemoryFileBrowserAdapter } from "react-file-browser/adapters/in-memory";
import { getFileBrowserDensityAttributes } from "react-file-browser/theme";

type DemoMode = {
  id:
    | "full"
    | "readonly"
    | "minimal"
    | "policy"
    | "compact"
    | "empty"
    | "denied";
  label: string;
  description: string;
};

const DEMO_MODES: DemoMode[] = [
  {
    id: "full",
    label: "Full",
    description: "All optional in-memory capabilities enabled.",
  },
  {
    id: "readonly",
    label: "Read-only",
    description: "Viewer mode with mutation affordances removed.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Rename, move, copy, exists, and server zip omitted.",
  },
  {
    id: "policy",
    label: "Upload policy",
    description: "MIME, size, and quota rejection paths enabled.",
  },
  {
    id: "compact",
    label: "Compact",
    description: "Same markup with compact density tokens.",
  },
  {
    id: "empty",
    label: "Empty",
    description: "Empty-folder state with create and upload affordances.",
  },
  {
    id: "denied",
    label: "Denied",
    description: "Access-denied loading state from the adapter.",
  },
];

const demoFile = (name: string, contents: string, type: string) =>
  new File([contents], name, { type });

export function App() {
  const fullAdapter = useMemo(
    () =>
      new InMemoryFileBrowserAdapter({
        capabilities: { multipart: true },
        multipartPartSize: 4,
      }),
    [],
  );
  const minimalAdapter = useMemo(
    () =>
      new InMemoryFileBrowserAdapter({
        capabilities: {
          bulkDownloadUrl: false,
          copy: false,
          createFolder: false,
          exists: false,
          move: false,
          rename: false,
        },
      }),
    [],
  );
  const emptyAdapter = useMemo(() => new InMemoryFileBrowserAdapter(), []);
  const deniedAdapter = useMemo(() => createAccessDeniedAdapter(), []);
  const seededRef = useRef(false);
  const [mode, setMode] = useState<DemoMode["id"]>("full");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;

    async function seedDemo() {
      await Promise.all([seedAdapter(fullAdapter), seedAdapter(minimalAdapter)]);
      setReady(true);
    }

    void seedDemo();
  }, [fullAdapter, minimalAdapter]);

  const activeMode = DEMO_MODES.find((item) => item.id === mode) ?? DEMO_MODES[0];
  const adapter =
    mode === "minimal"
      ? minimalAdapter
      : mode === "empty"
        ? emptyAdapter
        : mode === "denied"
          ? deniedAdapter
          : fullAdapter;
  const density: NonNullable<FileBrowserProps["density"]> =
    mode === "compact" ? "compact" : "comfortable";
  const uploadPolicy: FileBrowserProps["uploadPolicy"] =
    mode === "policy"
      ? {
          allowedMimeTypes: ["image/*", "application/pdf", ".md"],
          maxFileSizeBytes: 1024 * 1024,
          remainingQuotaBytes: 2 * 1024 * 1024,
        }
      : undefined;

  return (
    <main
      className="min-h-screen bg-[var(--fb-bg)] p-4 font-sans text-[var(--fb-text)] md:p-6"
      {...getFileBrowserDensityAttributes(density)}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3">
        <FileBrowserProvider>
          <section className="flex flex-wrap items-center gap-2 rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-2">
            <div className="mr-auto min-w-56 px-1">
              <h1 className="m-0 text-[14px] font-semibold">
                react-file-browser demo
              </h1>
              <p className="m-0 mt-0.5 text-[12px] text-[var(--fb-muted)]">
                {activeMode.description}
              </p>
            </div>
            {DEMO_MODES.map((item) => (
              <button
                aria-pressed={mode === item.id}
                className={`h-8 rounded-[calc(var(--fb-radius)-3px)] border px-2.5 text-[12px] font-medium outline-none transition focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${
                  mode === item.id
                    ? "border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] text-[var(--fb-accent)]"
                    : "border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-bg)]"
                }`}
                key={item.id}
                onClick={() => setMode(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </section>

          {ready || mode === "empty" || mode === "denied" ? (
            <FileBrowser
              adapter={adapter}
              density={density}
              key={mode}
              readOnly={mode === "readonly"}
              uploadPolicy={uploadPolicy}
              warnZipSizeBytes={64}
            />
          ) : (
            <div className="grid min-h-[520px] place-items-center rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-[12px] text-[var(--fb-muted)]">
              Loading demo files
            </div>
          )}
        </FileBrowserProvider>
      </div>
    </main>
  );
}

async function seedAdapter(adapter: InMemoryFileBrowserAdapter) {
  if (!adapter.createFolder) {
    await adapter.upload(
      "/quarterly-report.pdf",
      demoFile("quarterly-report.pdf", "PDF", "application/pdf"),
    );
    await adapter.upload(
      "/hero-banner.jpg",
      demoFile("hero-banner.jpg", "image", "image/jpeg"),
    );
    await adapter.upload(
      "/release-notes.md",
      demoFile("release-notes.md", "# Release notes", "text/markdown"),
    );
    return;
  }

  await adapter.createFolder("/assets");
  await adapter.createFolder("/assets/brand");
  await adapter.createFolder("/docs");
  await adapter.createFolder("/campaigns");
  await adapter.createFolder("/campaigns/q3-launch");
  await adapter.upload(
    "/docs/quarterly-report.pdf",
    demoFile("quarterly-report.pdf", "PDF", "application/pdf"),
  );
  await adapter.upload(
    "/docs/release-notes.md",
    demoFile("release-notes.md", "# Release notes", "text/markdown"),
  );
  await adapter.upload(
    "/hero-banner.jpg",
    demoFile("hero-banner.jpg", "image", "image/jpeg"),
  );
  await adapter.upload(
    "/assets/brand/logo.svg",
    demoFile("logo.svg", "<svg />", "image/svg+xml"),
  );
  await adapter.upload(
    "/campaigns/q3-launch/brief.txt",
    demoFile("brief.txt", "Launch brief", "text/plain"),
  );
}

function createAccessDeniedAdapter(): FileBrowserAdapter {
  const denied = (method: string) =>
    Promise.reject(
      new FileBrowserAdapterError(
        "access_denied",
        `Demo access denied from ${method}`,
      ),
    );

  return {
    createFolder: (path: string) => denied(`createFolder ${path}`),
    delete: (paths: string[]) => denied(`delete ${paths.join(", ")}`),
    list: (path: string) => denied(`list ${path}`),
    signedUrl: (path: string) => denied(`signedUrl ${path}`),
    upload: (path: string, file: File): Promise<FileNode> => {
      void file;
      return denied(`upload ${path}`);
    },
  };
}
