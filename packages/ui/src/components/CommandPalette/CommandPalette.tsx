'use client';

import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import { Command } from 'cmdk';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAiResourcesOptions,
  getAiConnectionsOptions,
  getWorkspacesOptions,
} from '@/clients/api/@tanstack/react-query.gen';

/**
 * Cmd+K (or Ctrl+K) command palette. Lets power users fuzzy-jump to
 * any AI Resource, AI Connection, workspace, or core navigation
 * destination without leaving the keyboard.
 *
 * Implementation notes:
 *
 * - Uses `cmdk` for the fuzzy filter + keyboard nav and an MUI Dialog
 *   as the modal shell so the styling matches the rest of the app.
 *
 * - Items are pulled from the same React Query hooks the rest of the
 *   app uses, so cached data is reused (no extra network on open).
 *
 * - Workspace-scoped items (resources, connections) only resolve when
 *   the URL already encodes a `(workspaceId, environmentId)` pair —
 *   off-workspace, only the static destinations + workspace switcher
 *   show.
 */
export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Global keyboard shortcut (Cmd+K / Ctrl+K).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Workspace context derived from the current pathname (React-tracked
  // via `usePathname()` so navigation updates the palette items).
  const wsCtx = useMemo(() => {
    if (!pathname) return null;
    const m = pathname.match(/^\/workspaces\/([^/]+)\/([^/]+)/);
    if (!m || m[2] === 'edit') return null;
    return { workspaceId: m[1], environmentId: m[2] };
  }, [pathname]);

  // All three queries are gated on `open` so we don't fetch them on
  // every page mount — the palette is closed 99 % of the time.
  // react-query caches across opens, so the first render after open
  // does the network roundtrip and subsequent opens hit the cache.
  const { data: resources } = useQuery({
    ...getAiResourcesOptions({
      path: {
        workspaceId: wsCtx?.workspaceId ?? '',
        environmentId: wsCtx?.environmentId ?? '',
      },
    }),
    enabled: open && !!wsCtx,
  });
  const { data: connections } = useQuery({
    ...getAiConnectionsOptions({
      path: {
        workspaceId: wsCtx?.workspaceId ?? '',
        environmentId: wsCtx?.environmentId ?? '',
      },
    }),
    enabled: open && !!wsCtx,
  });
  const { data: workspaces } = useQuery({
    ...getWorkspacesOptions({ query: { includesEnvironments: true } }),
    enabled: open,
  });

  const close = () => setOpen(false);
  const go = (href: string) => {
    close();
    router.push(href);
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogContent sx={{ p: 0 }}>
        <Command label="Command palette" loop>
          <Command.Input
            autoFocus
            placeholder="Search resources, connections, workspaces…"
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: 16,
              border: 'none',
              borderBottom: '1px solid var(--mui-palette-divider)',
              outline: 'none',
              backgroundColor: 'transparent',
              color: 'var(--mui-palette-text-primary)',
            }}
          />
          <Command.List
            style={{
              maxHeight: 360,
              overflow: 'auto',
              padding: '8px 0',
            }}
          >
            <Command.Empty
              style={{
                padding: '16px',
                color: 'var(--mui-palette-text-secondary)',
              }}
            >
              No results.
            </Command.Empty>

            <Command.Group heading="Navigation" style={paletteGroupStyle}>
              <PaletteItem onSelect={() => go('/getting-started')}>
                Getting Started
              </PaletteItem>
              <PaletteItem onSelect={() => go('/workspaces')}>
                Workspaces
              </PaletteItem>
              <PaletteItem onSelect={() => go('/settings/roles')}>
                Settings → Roles
              </PaletteItem>
              <PaletteItem onSelect={() => go('/settings/users')}>
                Settings → User Management
              </PaletteItem>
            </Command.Group>

            {wsCtx && (
              <Command.Group
                heading="In this environment"
                style={paletteGroupStyle}
              >
                <PaletteItem
                  onSelect={() =>
                    go(
                      `/workspaces/${wsCtx.workspaceId}/${wsCtx.environmentId}/playground`
                    )
                  }
                >
                  Playground
                </PaletteItem>
                <PaletteItem
                  onSelect={() =>
                    go(
                      `/workspaces/${wsCtx.workspaceId}/${wsCtx.environmentId}/insights/audit`
                    )
                  }
                >
                  Insights → Audit
                </PaletteItem>
                <PaletteItem
                  onSelect={() =>
                    go(
                      `/workspaces/${wsCtx.workspaceId}/${wsCtx.environmentId}/insights/usage`
                    )
                  }
                >
                  Insights → Usage
                </PaletteItem>
              </Command.Group>
            )}

            {wsCtx && resources && resources.length > 0 && (
              <Command.Group heading="AI Resources" style={paletteGroupStyle}>
                {resources.map((r) => (
                  <PaletteItem
                    key={r.resourceId}
                    onSelect={() =>
                      go(
                        `/workspaces/${wsCtx.workspaceId}/${wsCtx.environmentId}/ai-resources/edit/${r.resourceId}/general`
                      )
                    }
                  >
                    {r.name}
                  </PaletteItem>
                ))}
              </Command.Group>
            )}

            {wsCtx && connections && connections.length > 0 && (
              <Command.Group heading="AI Connections" style={paletteGroupStyle}>
                {connections.map((c) => (
                  <PaletteItem
                    key={c.connectionId}
                    onSelect={() =>
                      go(
                        `/workspaces/${wsCtx.workspaceId}/${wsCtx.environmentId}/ai-connections/edit/${c.connectionId}/general`
                      )
                    }
                  >
                    {c.name}
                  </PaletteItem>
                ))}
              </Command.Group>
            )}

            {workspaces && workspaces.length > 0 && (
              <Command.Group heading="Workspaces" style={paletteGroupStyle}>
                {workspaces.flatMap((w) =>
                  (w.environments ?? []).map((env) => (
                    <PaletteItem
                      key={`${w.workspaceId}-${env.environmentId}`}
                      onSelect={() =>
                        go(
                          `/workspaces/${w.workspaceId}/${env.environmentId}/ai-connections/overview`
                        )
                      }
                    >
                      {w.name} — {env.name}
                    </PaletteItem>
                  ))
                )}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const paletteGroupStyle: React.CSSProperties = {
  padding: '4px 8px',
  color: 'var(--mui-palette-text-secondary)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

function PaletteItem({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      style={{
        padding: '10px 16px',
        cursor: 'pointer',
        borderRadius: 6,
        margin: '0 8px',
        fontSize: 14,
        color: 'var(--mui-palette-text-primary)',
      }}
    >
      {children}
    </Command.Item>
  );
}
