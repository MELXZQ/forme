"use client";
import { useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/Select";
import { api } from "./client";
import { list, str, num, Table, type Row } from "../operations/ui";
import s from "../operations/Operations.module.css";
const severity = ["Information", "Task", "Warning", "Critical"];
export function NotificationDetail({
  data,
  actor,
  settings,
  reload,
}: {
  data: Row;
  actor: { id: string; role: string };
  settings: Row | null;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [reason, setReason] = useState(""),
    [people, setPeople] = useState<string[]>([]),
    [assignee, setAssignee] = useState("");
  const owner = actor.role === "admin",
    id = str(data.id);
  const date = (value: unknown) =>
    value
      ? new Date(str(value)).toLocaleString("en-AU", {
          timeZone: str(data.timezone) || "Australia/Melbourne",
        })
      : "—";
  const act = async (action: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`item/${id}`, {
        key: crypto.randomUUID(),
        version: data.version,
        action,
        reason:
          reason ||
          (action === "ack"
            ? "Confirmed awareness of the current version"
            : ""),
        ...(["pin", "reassign"].includes(action)
          ? { confirmerIds: people }
          : {}),
        ...(action === "assign" ? { assigneeId: assignee } : {}),
      });
      setReason("");
      await reload();
      setMessage(
        action === "ack"
          ? "Acknowledgement saved. The issue status has not been changed."
          : "Notification updated.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className={s.notice} role="status">
          {message}
        </p>
      )}

      <h2>{str(data.title)}</h2>
      <p>
        {severity[num(data.severity)]} · {str(data.status)} · Version{" "}
        {num(data.version)} · {data.pinned ? "Pinned" : "Not pinned"}
      </p>
      <p>{str(data.reason)}</p>
      <p>
        <strong>Suggested action:</strong> {str(data.action)}
      </p>
      <p>
        Occurred: {date(data.occurredAt)} · First generated:{" "}
        {date(data.createdAt)} · Updated: {date(data.updatedAt)} · Due:{" "}
        {date(data.deadlineAt)}
      </p>
      <Link href={str(data.link)}>Open related business record →</Link>
      <div className={s.split}>
        <div className={s.box}>
          <h2>At first trigger</h2>
          <Snapshot value={data.snapshot} />
        </div>
        <div className={s.box}>
          <h2>Latest checked data</h2>
          <Snapshot value={data.currentData} />
        </div>
      </div>
      <h2>Responsibility and confirmations</h2>
      <Table
        rows={list(data.people)}
        columns={[
          { key: "name", label: "Person" },
          {
            key: "active",
            label: "Account",
            render: (r) => (r.active ? "Active" : "Inactive"),
          },
          {
            key: "assignee",
            label: "Responsibility",
            render: (r) =>
              r.id === data.assigneeId ? "Responsible" : "Recipient",
          },
          {
            key: "confirmation",
            label: "Current version",
            render: (r) =>
              Array.isArray(data.confirmerIds) &&
              data.confirmerIds.includes(r.id)
                ? list(data.receipts).some(
                    (a) =>
                      a.userId === r.id &&
                      a.version === data.version &&
                      a.kind === "ACK",
                  )
                  ? "Confirmed"
                  : "Awaiting confirmation"
                : "Not required",
          },
        ]}
      />
      <p>
        Reading is personal. Confirmation acknowledges this version; it does not
        resolve the issue. Closed problems remain suppressed during the same
        continuous condition.
      </p>
      <div className={s.box}>
        <label>
          Outcome / internal note / reason
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className={s.actions}>
          <button
            disabled={
              busy ||
              !(
                Array.isArray(data.confirmerIds) &&
                data.confirmerIds.includes(actor.id)
              )
            }
            onClick={() => void act("ack")}
          >
            Confirm current version
          </button>
          {(owner ||
            (data.assigneeId === actor.id && actor.role === "warehouse")) && (
            <>
              <button
                disabled={busy || reason.trim().length < 3}
                onClick={() => void act("progress")}
              >
                Mark in progress
              </button>
              <button
                disabled={busy || reason.trim().length < 3}
                onClick={() => void act("note")}
              >
                Add internal note
              </button>
            </>
          )}
          {owner && (
            <>
              <button
                disabled={busy || reason.trim().length < 3}
                onClick={() => void act("resolve")}
              >
                Resolve with outcome
              </button>
              <button
                disabled={busy || reason.trim().length < 3}
                onClick={() => void act("dismiss")}
              >
                Close as not applicable
              </button>
              <button
                disabled={busy || reason.trim().length < 3}
                onClick={() => void act("unpin")}
              >
                Unpin after confirmations
              </button>
            </>
          )}
        </div>
        {owner && (
          <>
            <label>
              Responsible person
              <Select
                aria-label="Responsible person"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Choose person</option>
                {list(settings?.people).map((p) => (
                  <option value={str(p.id)} key={str(p.id)}>
                    {str(p.name)} · {str(p.role)}
                  </option>
                ))}
              </Select>
            </label>
            <button
              disabled={busy || !assignee || reason.trim().length < 3}
              onClick={() => void act("assign")}
            >
              Assign responsibility
            </button>
            <h3>Designated confirmers</h3>
            {list(settings?.people).map((p) => (
              <label className={s.field} key={str(p.id)}>
                <span>
                  <input
                    type="checkbox"
                    checked={people.includes(str(p.id))}
                    onChange={(e) =>
                      setPeople(
                        e.target.checked
                          ? [...people, str(p.id)]
                          : people.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {str(p.name)} · {str(p.role)}
                </span>
              </label>
            ))}
            <p>
              Replacing the list is explicit, recorded, and creates a new
              confirmation version. No one can confirm for another person.
            </p>
            <button
              disabled={busy || !people.length || reason.trim().length < 3}
              onClick={() => void act("pin")}
            >
              Pin with selected confirmers
            </button>
            <button
              disabled={busy || !people.length || reason.trim().length < 3}
              onClick={() => void act("reassign")}
            >
              Replace confirmer list with reason
            </button>
          </>
        )}
      </div>
      <h2>History</h2>
      {list(data.history).map((h) => (
        <div className={s.receipt} key={str(h.id)}>
          <strong>{str(h.action)}</strong> · {date(h.createdAt)} ·{" "}
          {str(list(data.people).find((p) => p.id === h.actorId)?.name) ||
            str(h.actorId)}
          <p>{str(h.reason)}</p>
          <details>
            <summary>Recorded change</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(h.data, null, 2)}
            </pre>
          </details>
        </div>
      ))}
      <details>
        <summary>Version and confirmation history</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(
            { versions: data.revisions, receipts: data.receipts },
            null,
            2,
          )}
        </pre>
      </details>
    </>
  );
}
function Snapshot({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item, i) => (
          <li key={i}>
            <Snapshot value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key} style={{ marginBottom: 12, overflowWrap: "anywhere" }}>
            <dt>
              <strong>
                {key
                  .replace(/([a-z])([A-Z])/g, "$1 $2")
                  .replace(/^./, (c) => c.toUpperCase())}
              </strong>
            </dt>
            <dd style={{ marginLeft: 12 }}>
              <Snapshot value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
