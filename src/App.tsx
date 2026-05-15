import { useEffect, useMemo, useState } from 'react'
import './App.css'

function getNow() {
  return new Date()
}

function App() {
  const [now, setNow] = useState(getNow)

  useEffect(() => {
    const scheduleUpdate = () => {
      const current = new Date()
      const delay =
        (60 - current.getSeconds()) * 1000 - current.getMilliseconds()

      return window.setTimeout(() => {
        setNow(new Date())
        timeoutId = scheduleUpdate()
      }, delay)
    }

    let timeoutId = scheduleUpdate()

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const formattedTime = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(now),
    [now],
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="StudieRommet home">
          StudieRommet
        </a>

        <time className="clock" dateTime={now.toISOString()} aria-live="polite">
          {formattedTime}
        </time>
      </header>

      <main className="dashboard">
        <section className="dashboard-panel" aria-labelledby="dashboard-title">
          <div className="dashboard-panel__header">
            <p className="eyebrow">Home</p>
            <h1 id="dashboard-title">Dashboard</h1>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
