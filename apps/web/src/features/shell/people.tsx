/**
 * Who has access to the project: the workspace's members, you first (ringed in green, D24), and
 * Claude, ringed in ember while it holds presence on the canvas (a turn runs, Story 5.5). There's
 * no live presence for people yet; this is the access list, not who is looking right now.
 */
import { useAgentPresence } from '@greenfield/editor-state/react';

export interface Person {
  userId: string;
  name: string | null;
  imageUrl: string | null;
}

const SHOWN = 3;

export function People({ people, meId }: { people: Person[]; meId: string }) {
  const sorted = [...people].sort((a, b) => Number(b.userId === meId) - Number(a.userId === meId));
  const shown = sorted.slice(0, SHOWN);
  const more = sorted.length - shown.length;
  const names = sorted.map((p) => (p.userId === meId ? 'You' : (p.name ?? 'Unnamed member')));
  return (
    <div className="flex items-center gap-1">
      <ul
        aria-label={`People with access: ${names.join(', ')}`}
        title={names.join(', ')}
        className="flex items-center gap-1"
      >
        {shown.map((p) => (
          <li key={p.userId} aria-hidden>
            <Avatar person={p} me={p.userId === meId} />
          </li>
        ))}
        {more > 0 && (
          <li
            aria-hidden
            className="flex size-7 items-center justify-center border border-border bg-surface-2 text-[11px] text-muted"
          >
            +{more}
          </li>
        )}
      </ul>
      <Claude />
    </div>
  );
}

function Claude() {
  const working = !!useAgentPresence()?.active;
  return (
    <span
      role="img"
      aria-label={working ? 'Claude, working' : 'Claude'}
      title={working ? 'Claude is working' : 'Claude'}
      data-testid="claude-avatar"
      data-active={working}
      className={`flex size-7 items-center justify-center bg-agent text-xs font-semibold text-ember-ink ${
        working ? 'relative z-10 outline-2 outline-offset-1 outline-agent outline' : ''
      }`}
    >
      C
    </span>
  );
}

function Avatar({ person, me }: { person: Person; me: boolean }) {
  const ring = me ? 'outline-2 outline-user z-10 relative' : 'outline-1 outline-surface';
  if (person.imageUrl)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Clerk avatars, 28 px
      <img src={person.imageUrl} alt="" className={`size-7 object-cover ${ring} outline`} />
    );
  const initial = (person.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`flex size-7 items-center justify-center bg-surface-2 text-xs font-medium text-text outline ${ring}`}
    >
      {initial}
    </span>
  );
}
