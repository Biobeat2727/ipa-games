import TapCategoryColumn from '../../components/TapCategoryColumn'

const CATEGORIES = ['Beer History', 'Local Breweries', 'Hops & Barley', 'Bar Trivia']
const POINT_VALUES = [100, 200, 300, 400, 500]

export default function TapPreview() {
  return (
    <div className="min-h-screen bg-gray-950 text-white p-3">
      <p className="text-center text-gray-500 text-sm mb-4">Click any full glass to test the drain animation</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${CATEGORIES.length}, minmax(0, 1fr))`, height: '80vh' }}>
        {CATEGORIES.map(cat => (
          <TapCategoryColumn key={cat} categoryName={cat} pointValues={POINT_VALUES} />
        ))}
      </div>
    </div>
  )
}
