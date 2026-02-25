# Cyber Archive - NUCES Past Papers Frontend

A premium, hacker-themed web interface for browsing and uploading past papers, powered by React, Tailwind CSS, and Framer Motion.

## 🚀 Features

- **Classy Hacker Aesthetic**: Deep space theme with Magenta accents.
- **Dynamic PDF Viewer**: Smooth resizing, infinite scroll, and custom scrollbars.
- **Secure Uploads**: Automated naming conventions and duplicate conflict detection.
- **Archive Explorer**: Real-time search and folder-based navigation.
- **Atmospheric UI**: Scanline effects, background noise, and micro-animations.

## 🛠️ Technology Stack

- **React 18**
- **Vite**
- **Tailwind CSS**
- **Framer Motion**
- **Lucide React** (Icons)
- **PDF.js** (Rendering)

## 📦 Deployment on Vercel

1. Push this branch to your GitHub repository.
2. Connect the repository in the Vercel Dashboard.
3. Configure the following **Environment Variables**:

| Variable | Description |
| --- | --- |
| `VITE_GITHUB_TOKEN` | GitHub Personal Access Token (with repo scope) |
| `VITE_GITHUB_OWNER` | Your GitHub Username |
| `VITE_GITHUB_REPO` | The name of the repository storing the PDFs |
| `VITE_GITHUB_BRANCH` | The branch name (default: `main`) |

## 🛡️ License

MIT Archive License.
