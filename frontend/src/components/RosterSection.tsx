import { useState } from 'react'
import type { RosterEntry, RosterUploadResponse } from '../types/monitoring'

interface RosterSectionProps {
  roster: RosterEntry[]
  addingStudent: boolean
  uploading: boolean
  uploadResult: RosterUploadResponse | null
  onAddStudent: (studentId: string, studentName: string) => void
  onDeleteEntry: (entryId: number) => void
  onCsvUpload: (file: File) => void
}

/**
 * Collapsible roster management section.
 * Keeps roster controls accessible but visually secondary during live monitoring.
 */
export function RosterSection({
  roster,
  addingStudent,
  uploading,
  uploadResult,
  onAddStudent,
  onDeleteEntry,
  onCsvUpload,
}: RosterSectionProps) {
  const [open, setOpen] = useState(false)
  const [newStudentId, setNewStudentId] = useState('')
  const [newStudentName, setNewStudentName] = useState('')

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newStudentId.trim() || !newStudentName.trim()) return
    onAddStudent(newStudentId.trim(), newStudentName.trim())
    setNewStudentId('')
    setNewStudentName('')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onCsvUpload(file)
    e.target.value = ''
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Student Roster</h2>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
            {roster.length}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-gray-100">
          {/* Add Student Form */}
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 mt-4 mb-4">
            <input
              type="text"
              placeholder="Student ID"
              value={newStudentId}
              onChange={(e) => setNewStudentId(e.target.value)}
              required
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
            <input
              type="text"
              placeholder="Student Name"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              required
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
            <button
              type="submit"
              disabled={addingStudent || !newStudentId.trim() || !newStudentName.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium transition-colors whitespace-nowrap"
            >
              {addingStudent ? 'Adding…' : 'Add Student'}
            </button>
          </form>

          {/* CSV Upload */}
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-xs font-medium text-gray-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {uploading ? 'Uploading…' : 'Upload CSV'}
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                disabled={uploading}
              />
            </label>
            <span className="text-xs text-gray-400">Format: student_id,name</span>
          </div>

          {/* Upload Result */}
          {uploadResult && (
            <div className={`rounded-lg p-3 mb-4 text-sm ${uploadResult.errors.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
              <p>
                <span className="font-medium">Added:</span> {uploadResult.added} |{' '}
                <span className="font-medium">Skipped:</span> {uploadResult.skipped}
              </p>
              {uploadResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-yellow-700 space-y-0.5">
                  {uploadResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Roster Table */}
          {roster.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">
              No students in the roster yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Student ID</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Name</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2 px-3 font-mono text-gray-800 text-xs">{entry.student_id}</td>
                      <td className="py-2 px-3 text-gray-700">{entry.student_name}</td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => onDeleteEntry(entry.id)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium transition-colors"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
