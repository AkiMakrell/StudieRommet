import './App.css'

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="StudieRommet home">
          StudieRommet
        </a>
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
