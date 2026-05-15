import { useEffect, useMemo, useState } from 'react'
import './App.css'

function getNow() {
  return new Date()
}

const navItems = ['Dashboard', 'Library', 'Planner', 'Sessions', 'Insights']

const subjects = [
  { name: 'Microeconomics', count: 18 },
  { name: 'Mathematics', count: 24 },
  { name: 'Accounting', count: 13 },
  { name: 'Management', count: 11 },
  { name: 'Statistics', count: 16 },
]

const filters = ['All', 'Notes', 'Lectures', 'Assignments', 'Readings']

const documents = [
  {
    title: 'Elasticity lecture notes',
    subject: 'Microeconomics',
    type: 'Notes',
    meta: 'Updated today',
    tags: ['Demand', 'Week 3'],
  },
  {
    title: 'Probability formulas',
    subject: 'Statistics',
    type: 'Reference',
    meta: 'Updated yesterday',
    tags: ['Exam', 'Formula sheet'],
  },
  {
    title: 'Budgeting case file',
    subject: 'Accounting',
    type: 'Assignment',
    meta: 'Added 3 days ago',
    tags: ['Case', 'Group work'],
  },
]

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

        <nav className="topnav" aria-label="Primary">
          {navItems.map((item) => (
            <a
              key={item}
              className={item === 'Library' ? 'nav-link is-active' : 'nav-link'}
              href="/"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="topbar-right">
          <button className="upload-button" type="button">
            Upload
          </button>

          <time className="clock" dateTime={now.toISOString()} aria-live="polite">
            {formattedTime}
          </time>
        </div>
      </header>

      <main className="dashboard">
        <div className="dashboard-layout">
          <aside className="sidebar" aria-label="Subjects">
            <div className="sidebar-section">
              <p className="eyebrow">Library</p>
              <div className="sidebar-links">
                <button className="sidebar-link is-active" type="button">
                  All documents
                </button>
                <button className="sidebar-link" type="button">
                  Recent
                </button>
                <button className="sidebar-link" type="button">
                  Pinned
                </button>
              </div>
            </div>

            <div className="sidebar-section">
              <p className="eyebrow">Subjects</p>
              <div className="subject-list">
                {subjects.map((subject) => (
                  <button key={subject.name} className="subject-item" type="button">
                    <span>{subject.name}</span>
                    <span className="subject-count">{subject.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="dashboard-panel" aria-labelledby="dashboard-title">
            <div className="dashboard-panel__header">
              <div>
                <p className="eyebrow">Library</p>
                <h1 id="dashboard-title">Notes and documents</h1>
              </div>
            </div>

            <div className="library-search">
              <label className="search-field">
                <span className="sr-only">Search notes and documents</span>
                <input type="search" placeholder="Search notes and documents" />
              </label>

              <button className="secondary-button" type="button">
                Filters
              </button>
            </div>

            <div className="filter-row" aria-label="Content filters">
              {filters.map((filter) => (
                <button
                  key={filter}
                  className={filter === 'All' ? 'filter-chip is-active' : 'filter-chip'}
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>

            <div className="library-grid">
              <section className="upload-panel">
                <div className="dropzone">
                  <p className="dropzone-title">Drop files here</p>
                  <button className="secondary-button" type="button">
                    Choose files
                  </button>
                </div>

                <div className="upload-meta">
                  <label className="field">
                    <span>Subject</span>
                    <select defaultValue="Microeconomics">
                      {subjects.map((subject) => (
                        <option key={subject.name} value={subject.name}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Type</span>
                    <select defaultValue="Notes">
                      <option>Notes</option>
                      <option>Lecture</option>
                      <option>Assignment</option>
                      <option>Reading</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Tags</span>
                    <input type="text" placeholder="Week 4, formulas" />
                  </label>
                </div>
              </section>

              <section className="documents-panel" aria-labelledby="document-list-title">
                <div className="documents-panel__header">
                  <h2 id="document-list-title">Recent documents</h2>
                </div>

                <div className="document-list">
                  {documents.map((document) => (
                    <article key={document.title} className="document-card">
                      <div className="document-card__top">
                        <div>
                          <h3>{document.title}</h3>
                          <p>{document.subject}</p>
                        </div>
                        <span className="document-type">{document.type}</span>
                      </div>

                      <div className="document-card__bottom">
                        <span>{document.meta}</span>
                        <div className="tag-list">
                          {document.tags.map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
