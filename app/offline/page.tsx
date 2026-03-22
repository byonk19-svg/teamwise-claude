// app/offline/page.tsx
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <h1 className="text-xl font-bold text-slate-900 mb-2">You&apos;re offline</h1>
        <p className="text-sm text-slate-500">
          Teamwise requires a connection. Please check your network and try again.
        </p>
      </div>
    </div>
  )
}
