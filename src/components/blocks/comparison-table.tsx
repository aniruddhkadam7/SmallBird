export type ComparisonRow = {
  label: string
  values: React.ReactNode[]
}

export function ComparisonTable({
  columns,
  rows,
  footnote,
}: {
  columns: string[]
  rows: ComparisonRow[]
  footnote?: string
}) {
  return (
    <div className="mt-6">
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-foreground/[0.02]">
              <th className="p-4 text-left font-medium text-muted-foreground">Criteria</th>
              {columns.map((col) => (
                <th key={col} className="p-4 text-left font-medium text-foreground">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-0">
                <td className="p-4 font-medium text-foreground">{row.label}</td>
                {row.values.map((value, i) => (
                  <td key={i} className="p-4 text-muted-foreground">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote ? <p className="mt-3 text-xs text-muted-foreground">{footnote}</p> : null}
    </div>
  )
}
