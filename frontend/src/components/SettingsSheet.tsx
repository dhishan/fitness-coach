interface SettingsSheetProps {
  open: boolean
  onClose: () => void
}

export default function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="card relative w-full max-w-lg p-6 rounded-b-none z-10">
        <h2 className="text-lg font-semibold mb-4 text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500">Settings coming in Task 3.</p>
        <button
          onClick={onClose}
          className="mt-6 w-full py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium"
        >
          Close
        </button>
      </div>
    </div>
  )
}
