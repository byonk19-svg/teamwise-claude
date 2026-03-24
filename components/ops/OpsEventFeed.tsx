export interface OpsEventItem {
  id: string
  ts: string
  type: string
  actor: string
  summary: string
  href?: string
}

interface Props {
  events: OpsEventItem[]
}

export function OpsEventFeed({ events }: Props) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No events for selected filters.</p>
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 text-slate-500 font-medium">Time</th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium">Type</th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium">Actor</th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium">Summary</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2 whitespace-nowrap text-slate-700">{new Date(e.ts).toLocaleString()}</td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-700">{e.type}</td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-700">{e.actor}</td>
              <td className="px-3 py-2 text-slate-600">
                {e.href ? (
                  <a className="underline decoration-slate-300 hover:decoration-slate-500" href={e.href}>
                    {e.summary}
                  </a>
                ) : (
                  e.summary
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
