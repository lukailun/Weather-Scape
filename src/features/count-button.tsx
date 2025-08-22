import { useReducer } from "react"

export const CountButton = () => {
  const [count, increase] = useReducer((c) => c + 1, 0)

  return (
    <button
      onClick={() => increase()}
      type="button"
      className="weatherscape-flex weatherscape-flex-row weatherscape-items-center weatherscape-px-4 weatherscape-py-2 weatherscape-text-sm weatherscape-rounded-lg weatherscape-transition-all weatherscape-border-none
      weatherscape-shadow-lg hover:weatherscape-shadow-md
      active:weatherscape-scale-105 weatherscape-bg-slate-50 hover:weatherscape-bg-slate-100 weatherscape-text-slate-800 hover:weatherscape-text-slate-900">
      Count:
      <span className="weatherscape-inline-flex weatherscape-items-center weatherscape-justify-center weatherscape-w-8 weatherscape-h-4 weatherscape-ml-2 weatherscape-text-xs weatherscape-font-semibold weatherscape-rounded-full">
        {count}
      </span>
    </button>
  )
}