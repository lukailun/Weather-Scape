import { useReducer } from "react"

export const CountButton = () => {
  const [count, increase] = useReducer((c) => c + 1, 0)

  return (
    <button
      onClick={() => increase()}
      type="button"
      className="ws-flex ws-flex-row ws-items-center ws-px-4 ws-py-2 ws-text-sm ws-rounded-lg ws-transition-all ws-border-none
      ws-shadow-lg hover:ws-shadow-md
      active:ws-scale-105 ws-bg-slate-50 hover:ws-bg-slate-100 ws-text-slate-800 hover:ws-text-slate-900">
      Count:
      <span className="ws-inline-flex ws-items-center ws-justify-center ws-w-8 ws-h-4 ws-ml-2 ws-text-xs ws-font-semibold ws-rounded-full">
        {count}
      </span>
    </button>
  )
}