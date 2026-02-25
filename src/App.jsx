import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, 
  Search, 
  ChevronRight, 
  ChevronDown, 
  X, 
  Download, 
  Link as LinkIcon, 
  RefreshCw,
  Plus,
  AlertCircle,
  FileDown,
  ExternalLink,
  Archive,
  Menu,
  DownloadCloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CONFIG } from './config';

// ===== PDF Page Component =====
const STATIC_RENDER_SCALE = 2.0;

const PDFPage = ({ pdf, pageNum, scale }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let active = true;
    pdf.getPage(pageNum).then(page => {
      if (active) {
        const viewport = page.getViewport({ scale: 1.0 });
        setPageSize({ width: viewport.width, height: viewport.height });
      }
    });
    return () => { active = false; };
  }, [pdf, pageNum]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { rootMargin: '600px' }
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const renderPage = async () => {
      if (!pdf || !canvasRef.current || !isVisible || isRendered) return;

      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: STATIC_RENDER_SCALE });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        const ratio = window.devicePixelRatio || 1;

        canvas.height = viewport.height * ratio;
        canvas.width = viewport.width * ratio;
        context.scale(ratio, ratio);

        renderTaskRef.current = page.render({ canvasContext: context, viewport });
        await renderTaskRef.current.promise;
        setIsRendered(true);
      } catch (err) {
        console.error('Page render error:', err);
      }
    };

    renderPage();
  }, [pdf, pageNum, isVisible, isRendered]);

  return (
    <div 
      ref={containerRef}
      className="mb-8 last:mb-0"
      style={{ 
        opacity: isRendered ? 1 : 0.4,
        width: pageSize.width ? `${pageSize.width * scale}px` : '100%',
        height: pageSize.height ? `${pageSize.height * scale}px` : 'auto'
      }}
    >
      <div className="w-full h-full bg-white shadow-2xl overflow-hidden rounded-sm">
        <canvas ref={canvasRef} className="block w-full h-full pointer-events-none" />
      </div>
    </div>
  );
};

// ===== Sidebar Item Component =====
const SidebarItem = ({ item, level = 0, onSelect, activeFile }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isFolder = item.type === 'tree';
  const isActive = activeFile?.path === item.path;
  
  const toggleExpand = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="mb-0.5">
      <div 
        className={`flex items-center py-2.5 px-3.5 rounded-xl cursor-pointer transition-all duration-200 group relative
          ${isActive ? 'bg-cyber-accent/10 border border-cyber-accent/20 text-cyber-accent' : 'hover:bg-white/5 text-cyber-text-secondary hover:text-white'}`}
        style={{ marginLeft: `${level * 0.75}rem` }}
        onClick={isFolder ? toggleExpand : () => onSelect(item)}
      >
        <span className={`mr-3 shrink-0 transition-colors ${isActive ? 'text-cyber-accent' : 'opacity-60'}`}>
          {isFolder ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <FileText size={14} />
          )}
        </span>
        <span className={`flex-1 truncate text-xs font-bold tracking-tight ${isActive ? 'text-cyber-accent' : ''}`}>
          {item.name.replace('.pdf', '')}
        </span>
      </div>
      
      <AnimatePresence>
        {isFolder && isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-l border-white/5 ml-4"
          >
            {item.children.map((child) => (
              <SidebarItem key={child.path} item={child} level={level + 1} onSelect={onSelect} activeFile={activeFile} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ===== Main App Component =====
const App = () => {
  const [rawFiles, setRawFiles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentFile, setCurrentFile] = useState(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [pdfRef, setPdfRef] = useState(null);
  const [displayScale, setDisplayScale] = useState(1.0);
  const [uploadStatus, setUploadStatus] = useState({ message: '', type: '' });

  const viewerRef = useRef(null);

  const fetchRepoFiles = async () => {
    if (!CONFIG.GITHUB_TOKEN) {
      setFetchError('Configuration Error: Credentials missing.');
      return;
    }
    
    setIsLoading(true);
    setFetchError(null);
    
    try {
      const response = await fetch(
        `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/git/trees/${CONFIG.GITHUB_BRANCH}?recursive=1`,
        { headers: { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}` } }
      );
      
      if (!response.ok) throw new Error('Failed to fetch archive');
      
      const data = await response.json();
      setRawFiles(data.tree.filter(item => item.path.endsWith('.pdf')));
    } catch (error) {
      console.error(error);
      setFetchError('Uplink Interrupted: Unable to retrieve files.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchRepoFiles(); }, []);

  const handleFileSelect = async (file) => {
    setPdfRef(null);
    setCurrentFile(file);
    try {
      const response = await fetch(
        `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${file.path}`,
        { headers: { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3.raw' } }
      );
      const arrayBuffer = await response.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfRef(pdf);
      setCurrentFile({ ...file, blobUrl: URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/pdf' })) });
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setDisplayScale(prev => Math.min(Math.max(prev + (-e.deltaY * 0.01), 0.5), 3.0));
      }
    };
    viewer.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', handleWheel);
  }, [currentFile]);

  const treeData = useMemo(() => {
    const root = [];
    const sorted = [...rawFiles].sort((a,b) => a.path.localeCompare(b.path));
    sorted.forEach(file => {
      if (searchQuery && !file.path.toLowerCase().includes(searchQuery.toLowerCase())) return;
      const parts = file.path.split('/');
      let currentLevel = root;
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        let existing = currentLevel.find(item => item.name === part);
        if (!existing) {
          existing = { name: part, path: parts.slice(0, index + 1).join('/'), type: isLast ? 'blob' : 'tree', children: [], childrenCount: 0 };
          currentLevel.push(existing);
        }
        if (!isLast) { existing.childrenCount++; currentLevel = existing.children; }
      });
    });
    return root;
  }, [rawFiles, searchQuery]);

  const handleUpload = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const file = formData.get('pdfFile');
    const examType = formData.get('examType');
    const subject = formData.get('subject');
    const session = formData.get('session');
    const year = formData.get('year');

    setUploadStatus({ message: 'Initializing...', type: 'loading' });

    try {
      // Generate clean name without UUID
      const cleanSubject = subject.replace(/[^a-zA-Z0-9]/g, '');
      const name = `${examType}_${cleanSubject}_${session}_${year}.pdf`.toLowerCase();
      const targetPath = `${subject}/${examType}/${name}`.toLowerCase();

      // Check if file already exists in rawFiles
      const exists = rawFiles.some(f => f.path.toLowerCase() === targetPath);

      if (exists) {
        setUploadStatus({ message: 'Conflict: File already exists in archive.', type: 'error' });
        return;
      }

      setUploadStatus({ message: 'Uploading...', type: 'loading' });

      const reader = new FileReader();
      const content = await new Promise((res) => {
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });

      const res = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${targetPath}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}` },
        body: JSON.stringify({ 
          message: `Upload: ${name}`, 
          content, 
          branch: CONFIG.GITHUB_BRANCH 
        })
      });

      if (!res.ok) throw new Error();
      
      setUploadStatus({ message: 'Uploaded successfully', type: 'success' });
      setTimeout(() => { 
        setIsUploadModalOpen(false); 
        fetchRepoFiles(); 
        setUploadStatus({ message: '', type: '' }); 
      }, 1500);
    } catch (e) { 
      setUploadStatus({ message: 'Upload failed: Uploade interrupted.', type: 'error' }); 
    }
  };

  if (!window.pdfjsLib) return (
    <div className="h-screen bg-cyber-black flex items-center justify-center font-mono text-cyber-accent">
      <RefreshCw className="animate-spin mr-3" size={20} />
      <span>Loading Cyber Archive...</span>
    </div>
  );

  return (
    <div className="flex h-screen bg-cyber-black text-cyber-text-primary overflow-hidden font-hack relative">
      <div className="noise" />
      
      {/* Sidebar */}
      <aside className="w-80 flex-shrink-0 flex flex-col border-r border-white/5 bg-cyber-darker relative z-30">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <Archive className="text-cyber-accent" size={24} />
            <h1 className="text-xl font-bold tracking-tight text-white">Cyber Archive</h1>
          </div>
          
          <div className="relative group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyber-text-secondary" />
            <input 
              type="text" placeholder="Search archive..." 
              className="cyber-input pl-10"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar">
          {isLoading ? (
            <div className="space-y-4 pt-4">
              {[...Array(8)].map((_, i) => (
                <motion.div 
                  key={i}
                  animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.01, 1] }}
                  transition={{ repeat: Infinity, duration: 2, delay: i * 0.15 }}
                  className="h-10 w-full bg-white/5 rounded-xl border border-white/5"
                />
              ))}
            </div>
          ) : fetchError ? (
            <div className="mt-8 p-6 rounded-2xl bg-red-500/5 border border-red-500/10 text-center">
              <AlertCircle className="mx-auto mb-4 text-red-100 opacity-40" size={24} />
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-[0.2em] leading-relaxed">
                {fetchError}
              </p>
              <button 
                onClick={fetchRepoFiles}
                className="mt-6 px-4 py-2 text-[10px] font-bold text-white/40 hover:text-white uppercase tracking-widest border border-white/10 rounded-lg hover:bg-white/5 transition-all"
              >
                Reconnect Archive
              </button>
            </div>
          ) : (
            treeData.map((item) => <SidebarItem key={item.path} item={item} onSelect={handleFileSelect} activeFile={currentFile} />)
          )}
        </div>

        <div className="p-6 border-t border-white/5 bg-cyber-darker">
            <button 
              onClick={() => setIsUploadModalOpen(true)} 
              disabled={isLoading || !!fetchError}
              className={`cyber-btn-primary w-full py-3.5 tracking-wide h-12 ${isLoading || fetchError ? 'opacity-30 grayscale cursor-not-allowed shadow-none' : ''}`}
            >
                {isLoading ? (
                  <RefreshCw size={18} className="animate-spin text-white/50" />
                ) : (
                  <Plus size={18} />
                )}
                <span>{isLoading ? 'Scanning Archive...' : 'Upload Paper'}</span>
            </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col min-w-0 bg-cyber-black">
        <AnimatePresence mode="wait">
          {!currentFile ? (
            <motion.div key="welcome" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="w-28 h-28 mb-8 rounded-[2.5rem] bg-cyber-accent/10 flex items-center justify-center text-5xl shadow-inner border border-cyber-accent/20">
                📚
              </div>
              <h2 className="text-4xl font-black mb-4 tracking-tight text-white uppercase">Cyber Archive</h2>
              <p className="text-cyber-text-secondary max-w-sm mx-auto mb-8 leading-relaxed text-sm font-medium">
                Contribute to this repo by uploading if not uploaded already. Select a file from the sidebar to view.
              </p>
            </motion.div>
          ) : (
            <motion.div key="viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col min-h-0">
              <header className="flex items-center justify-between px-10 py-6 border-b border-white/5 bg-cyber-darker/50 backdrop-blur-md relative z-20">
                <div className="flex items-center gap-5 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-cyber-accent/10 flex items-center justify-center text-cyber-accent border border-cyber-accent/20 shadow-lg shadow-cyber-accent/5">
                    <FileText size={22} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm text-white truncate uppercase tracking-tight">{currentFile.name.replace('.pdf', '')}</h3>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-cyber-accent text-white shadow-[0_0_20px_rgba(232,17,122,0.3)] hover:shadow-[0_0_25px_rgba(232,17,122,0.5)] transition-all" 
                    onClick={() => { const a = document.createElement('a'); a.href = currentFile.blobUrl; a.download = currentFile.name; a.click(); }} 
                    title="Download"
                  >
                    <motion.div
                      animate={{ y: [0, 2, 0] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                    >
                      <FileDown size={18} />
                    </motion.div>
                  </motion.button>
                  <div className="h-4 w-px bg-white/10 mx-1" />
                  <button className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/10" onClick={() => setCurrentFile(null)}><X size={18} /></button>
                </div>
              </header>

              <div ref={viewerRef} className="flex-1 overflow-auto p-12 lg:p-20 custom-scrollbar bg-[#05070a]">
                {!pdfRef ? (
                  <div className="h-full flex items-center justify-center text-cyber-text-secondary">
                    <RefreshCw size={24} className="animate-spin mr-3 opacity-20" />
                    <span>Loading Document...</span>
                  </div>
                ) : (
                  <div className="max-w-fit mx-auto flex flex-col items-center">
                    {[...Array(pdfRef.numPages)].map((_, i) => (
                      <PDFPage key={`${currentFile.path}-${i}`} pdf={pdfRef} pageNum={i + 1} scale={displayScale} />
                    ))}
                  </div>
                )}
              </div>

              <footer className="px-10 py-5 border-t border-white/5 bg-cyber-darker/50 backdrop-blur-md flex items-center justify-between text-[11px] text-cyber-text-secondary">
                <div className="font-bold uppercase tracking-widest opacity-60">
                    Total Pages: {pdfRef?.numPages || 0}
                </div>
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" min="0.5" max="3.0" step="0.01" value={displayScale} 
                      className="w-40 h-1 bg-white/5 rounded-full accent-cyber-accent appearance-none cursor-pointer" 
                      onChange={(e) => setDisplayScale(parseFloat(e.target.value))} 
                    />
                    <span className="min-w-[45px] font-mono text-cyber-accent font-black tabular-nums">{(displayScale * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Upload Modal */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={() => setIsUploadModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-lg bg-cyber-darker border border-white/5 shadow-2xl rounded-[2rem] p-8 relative overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyber-accent/10 blur-[80px]" />
              
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-cyber-accent flex items-center justify-center shadow-lg shadow-cyber-accent/20">
                        <Plus className="text-white" size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">Upload Document</h2>
                    </div>
                </div>
                <button 
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsUploadModalOpen(false);
                  }} 
                  className="p-2 rounded-xl hover:bg-white/5 text-cyber-text-secondary hover:text-white transition-all relative z-[110]"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleUpload} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Subject</label>
                    <select name="subject" required className="cyber-input appearance-none">{CONFIG.SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Type</label>
                    <select name="examType" required className="cyber-input appearance-none"><option value="Finals">Finals</option><option value="Sessional-1">Sessional-1</option><option value="Sessional-2">Sessional-2</option><option value="Labs">Labs</option></select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Session</label>
                    <select name="session" required className="cyber-input appearance-none">{CONFIG.SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Year</label>
                    <input 
                      type="number" 
                      name="year" 
                      defaultValue={new Date().getFullYear()} 
                      min="2015" 
                      max={new Date().getFullYear()} 
                      required 
                      className="cyber-input" 
                    />
                  </div>
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">PDF File</label>
                    <input type="file" name="pdfFile" accept=".pdf" required className="w-full text-sm text-cyber-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/5 file:text-white file:font-semibold hover:file:bg-white/10 cursor-pointer" />
                </div>

                {uploadStatus.message && (
                  <div className={`p-4 rounded-xl text-xs font-bold border ${uploadStatus.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/10' : 'bg-green-500/10 text-green-400 border-green-500/10'}`}>
                    {uploadStatus.message}
                  </div>
                )}

                <button type="submit" disabled={uploadStatus.type === 'loading'} className="cyber-btn-primary w-full py-4 text-xs font-bold tracking-[0.2em] uppercase rounded-xl active:scale-95">
                    {uploadStatus.type === 'loading' ? 'Encrypting Payload...' : 'Submit to Archive'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
