'use client'

interface BlockOption {
  id: string
  shift_type: 'day' | 'night'
  start_date: string
  end_date: string
}

interface Props {
  shift: 'all' | 'day' | 'night'
  blockId: string
  from: string
  to: string
  blocks: BlockOption[]
}

export function OpsFilters({ shift, blockId, from, to, blocks }: Props) {
  return (
    <form className="grid grid-cols-1 md:grid-cols-5 gap-2">
      <select
        name="shift"
        defaultValue={shift}
        className="border border-slate-200 rounded-md px-2 py-1.5 text-sm"
      >
        <option value="all">All shifts</option>
        <option value="day">Day</option>
        <option value="night">Night</option>
      </select>

      <select
        name="blockId"
        defaultValue={blockId}
        className="border border-slate-200 rounded-md px-2 py-1.5 text-sm md:col-span-2"
      >
        <option value="">All blocks</option>
        {blocks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.shift_type} {b.start_date} to {b.end_date}
          </option>
        ))}
      </select>

      <input
        type="date"
        name="from"
        defaultValue={from}
        className="border border-slate-200 rounded-md px-2 py-1.5 text-sm"
      />
      <input
        type="date"
        name="to"
        defaultValue={to}
        className="border border-slate-200 rounded-md px-2 py-1.5 text-sm"
      />

      <div className="md:col-span-5 flex gap-2">
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-800"
        >
          Apply
        </button>
        <a
          href="/ops"
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
        >
          Reset
        </a>
      </div>
    </form>
  )
}
