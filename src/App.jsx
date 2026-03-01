import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, 
  Search, 
  ChevronRight, 
  ChevronDown, 
  X, 
  Download, 
  RefreshCw,
  Plus,
  AlertCircle,
  AlertTriangle,
  FileDown,
  ExternalLink,
  Archive,
  Menu,
  Lock,
  LogOut,
  Trash2,
  Key,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CONFIG } from './config';

// ===== PDF Page Component =====
const STATIC_RENDER_SCALE = 2.0;

const PDFPage = React.memo(({ pdf, pageNum, scale }) => {
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
    return () => { 
      active = false; 
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
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
        if (err.name !== 'RenderingCancelledException') {
          console.error('Page render error:', err);
        }
      }
    };

    renderPage();
    
    // Cleanup if component unmounts mid-render
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdf, pageNum, isVisible, isRendered]);

  return (
    <div 
      ref={containerRef}
      className="mb-8 last:mb-0"
      style={{ 
        opacity: isRendered ? 1 : 0.4,
        width: pageSize.width ? `${pageSize.width}px` : '100%',
        height: pageSize.height ? `${pageSize.height}px` : 'auto',
        transform: `scale(${scale})`,
        transformOrigin: 'top center'
      }}
    >
      <div className="w-full h-full bg-white shadow-2xl overflow-hidden rounded-sm">
        <canvas ref={canvasRef} className="block w-full h-full pointer-events-none" />
      </div>
    </div>
  );
});

// ===== Sidebar Item Component =====
const SidebarItem = React.memo(({ item, level = 0, onSelect, activeFile }) => {
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
});

// ===== Main App Component =====
const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/archive-api`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

const App = () => {
  const [rawFiles, setRawFiles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterExamType, setFilterExamType] = useState('');
  const [currentFile, setCurrentFile] = useState(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  
  // Custom Routing
  const isAdminRoute = window.location.pathname === '/admin';
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(isAdminRoute && !localStorage.getItem('adminToken'));
  
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [adminToken, setAdminToken] = useState(localStorage.getItem('adminToken') || null);
  const [authStatus, setAuthStatus] = useState({ message: '', type: '' });
  const [fileToDelete, setFileToDelete] = useState(null);
  const [deleteStatus, setDeleteStatus] = useState({ message: '', type: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [pdfRef, setPdfRef] = useState(null);
  const [displayScale, setDisplayScale] = useState(1.0);
  const [uploadStatus, setUploadStatus] = useState({ message: '', type: '' });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Queue state (admin only)
  const [queuedFiles, setQueuedFiles] = useState([]);
  const [queueAction, setQueueAction] = useState(null); // { file, type: 'approve'|'reject' }
  const [queueStatus, setQueueStatus] = useState({ message: '', type: '' });
  const [currentQueueFile, setCurrentQueueFile] = useState(null); // file being previewed from queue
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);

  const viewerRef = useRef(null);

  const fetchRepoFiles = async () => {
    setIsLoading(true);
    setFetchError(null);
    
    try {
      const response = await fetch(`${API_URL}?action=list`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken || ANON_KEY}` }
      });
      if (!response.ok) throw new Error('Failed to fetch files');
      const data = await response.json();

      setRawFiles(data);
    } catch (error) {
      console.error(error);
      setFetchError('Uplink Interrupted: Unable to retrieve files from database.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchRepoFiles(); }, []);

  const fetchQueue = async () => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API_URL}?action=list_queue`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setQueuedFiles(data);
      }
    } catch (e) { console.error('Failed to fetch queue', e); }
  };

  useEffect(() => { if (adminToken && isAdminRoute) fetchQueue(); }, [adminToken]);

  const handleFileSelect = async (file) => {
    // 🧹 Clean up previous object URL to prevent memory leaks
    if (currentFile?.blobUrl) {
      URL.revokeObjectURL(currentFile.blobUrl);
    }
    
    setPdfRef(null);
    setCurrentFile(file);
    setIsSidebarOpen(false);
    setDisplayScale(1.0); // 🔍 Reset zoom when changing files
    
    try {
      const response = await fetch(`${API_URL}?action=download&path=${encodeURIComponent(file.path)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken || ANON_KEY}` }
      });

      if (!response.ok) throw new Error('Failed to download PDF');

      const data = await response.blob();
      
      // 1. Create the pure, untouched Object URL from the raw blob immediately
      const pristineBlobUrl = URL.createObjectURL(data);
      
      // 2. Read the ArrayBuffer *separately* purely for rendering in pdfjs
      const arrayBuffer = await data.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      setPdfRef(pdf);
      setCurrentFile({ 
        ...file, 
        blobUrl: pristineBlobUrl // The button will use this pristine blob instead of a re-assembled one
      });
    } catch (error) {
      console.error('Failed to load PDF:', error);
    }
  };
  
  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (currentFile?.blobUrl) {
        URL.revokeObjectURL(currentFile.blobUrl);
      }
    };
  }, [currentFile]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        // Limit minimum scale to 1.0 so UI percentage never drops below 0%
        setDisplayScale(prev => Math.min(Math.max(prev + (-e.deltaY * 0.01), 1.0), 3.0));
      }
    };
    viewer.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', handleWheel);
  }, [currentFile]);

  const treeData = useMemo(() => {
    const isFiltering = searchQuery || filterExamType;
    const sorted = [...rawFiles].sort((a,b) => a.path.localeCompare(b.path));
    
    // If filtering, return a flat list of matching files
    if (isFiltering) {
      return sorted
        .filter(file => {
          if (searchQuery && !file.path.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          if (filterExamType && file.exam_type !== filterExamType) return false;
          return true;
        })
        .map(file => ({
          name: file.name,
          path: file.path,
          type: 'blob',
          originalFile: file // Keep reference to full file data if needed
        }));
    }

    // Otherwise, build the folder tree
    const root = [];
    sorted.forEach(file => {
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
  }, [rawFiles, searchQuery, filterExamType]);

  const activeFilterCount = filterExamType ? 1 : 0;

  // ===== AUTHENTICATION HANDLERS =====
  const handleLogin = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const username = formData.get('username');
    const password = formData.get('password');
    setAuthStatus({ message: 'Authenticating...', type: 'loading' });

    try {
      const res = await fetch(`${API_URL}?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      
      setAdminToken(data.token);
      localStorage.setItem('adminToken', data.token);
      setIsLoginModalOpen(false);
      setAuthStatus({ message: '', type: '' });
    } catch (error) {
      setAuthStatus({ message: error.message, type: 'error' });
    }
  };

  const handleLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('adminToken');
    // Force relogin if they are still on the admin page
    if (isAdminRoute) {
      setIsLoginModalOpen(true);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    setAuthStatus({ message: 'Updating...', type: 'loading' });

    try {
      const res = await fetch(`${API_URL}?action=update_password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ 
          username: formData.get('username'), 
          current_password: formData.get('current_password'),
          new_password: formData.get('new_password')
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      
      setAuthStatus({ message: 'Password updated successfully.', type: 'success' });
      setTimeout(() => {
         setIsPasswordModalOpen(false);
         setAuthStatus({ message: '', type: '' });
         handleLogout(); // Force relogin on password change
      }, 1500);
    } catch (error) {
      setAuthStatus({ message: error.message, type: 'error' });
    }
  };

  const handleQueuePreview = async (file) => {
    if (currentFile?.blobUrl) URL.revokeObjectURL(currentFile.blobUrl);
    setPdfRef(null);
    // Set placeholder immediately so the viewer shows loading spinner right away
    setCurrentFile({ ...file, _isQueued: true, _isLoading: true });
    setCurrentQueueFile(file);
    setIsSidebarOpen(false);
    setDisplayScale(1.0);
    setIsLoadingQueue(true);
    try {
      const response = await fetch(`${API_URL}?action=download_queue&path=${encodeURIComponent(file.path)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (!response.ok) throw new Error('Failed to load queued PDF');
      const data = await response.blob();
      const pristineBlobUrl = URL.createObjectURL(data);
      const arrayBuffer = await data.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfRef(pdf);
      setCurrentFile({ ...file, blobUrl: pristineBlobUrl, _isQueued: true });
    } catch (error) { console.error(error); } finally { setIsLoadingQueue(false); }
  };

  const executeQueueAction = async () => {
    if (!queueAction) return;
    const { file, type } = queueAction;
    setQueueStatus({ message: type === 'approve' ? 'Approving...' : 'Rejecting...', type: 'loading' });
    try {
      let res;
      if (type === 'approve') {
        res = await fetch(`${API_URL}?action=approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify({ path: file.path })
        });
      } else {
        res = await fetch(`${API_URL}?action=reject&path=${encodeURIComponent(file.path)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${adminToken}` }
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      // Clear viewer if this file was being previewed
      if (currentFile?.path === file.path) {
        if (currentFile?.blobUrl) URL.revokeObjectURL(currentFile.blobUrl);
        setCurrentFile(null);
        setPdfRef(null);
        setCurrentQueueFile(null);
      }
      setQueueStatus({ message: type === 'approve' ? '✓ Paper approved and published!' : '✓ Paper rejected and deleted.', type: 'success' });
      fetchQueue();
      if (type === 'approve') fetchRepoFiles();
      setTimeout(() => { setQueueAction(null); setQueueStatus({ message: '', type: '' }); }, 1500);
    } catch (error) {
      setQueueStatus({ message: error.message, type: 'error' });
    }
  };

  const requestDelete = (file) => {
    if (!adminToken) return;
    setFileToDelete(file);
    setDeleteStatus({ message: '', type: '' });
  };

  const executeDelete = async () => {
    if (!adminToken || !fileToDelete) return;

    setDeleteStatus({ message: 'Purging from database and storage...', type: 'loading' });
    try {
      const res = await fetch(`${API_URL}?action=delete&path=${encodeURIComponent(fileToDelete.path)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (!res.ok) throw new Error('Delete failed');
      
      if (currentFile?.path === fileToDelete.path) {
         if (currentFile?.blobUrl) URL.revokeObjectURL(currentFile.blobUrl);
         setCurrentFile(null);
      }
      fetchRepoFiles();
      setDeleteStatus({ message: 'File permanently deleted.', type: 'success' });
      setTimeout(() => {
        setFileToDelete(null);
        setDeleteStatus({ message: '', type: '' });
      }, 1500);
    } catch (error) {
      setDeleteStatus({ message: error.message, type: 'error' });
    }
  };

  // ===== UPLOAD HANDLER =====
  const handleUpload = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const file = formData.get('pdfFile');
    const examType = formData.get('examType');
    const subject = formData.get('subject');
    const session = formData.get('session');
    const year = formData.get('year');

    setUploadStatus({ message: 'Initializing...', type: 'loading' });

    // 1. File size validation
    if (file.size > CONFIG.MAX_FILE_SIZE) {
      setUploadStatus({ message: `Error: File size exceeds ${CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB.`, type: 'error' });
      return;
    }

    // 2. MIME type validation 
    if (file.type !== 'application/pdf') {
       setUploadStatus({ message: 'Error: Only PDF files are permitted for upload.', type: 'error' });
       return;
    }

    // 3. Input sanitization / validation
    if (!CONFIG.SUBJECTS.includes(subject)) {
       setUploadStatus({ message: 'Error: Invalid subject selected.', type: 'error' });
       return;
    }
    
    // Validate examtype against the appropriate config array instead of just assuming theory vs lab
    const isValidTheory = !subject.toLowerCase().includes('lab') && CONFIG.EXAM_TYPES_THEORY.includes(examType);
    const isValidLab = subject.toLowerCase().includes('lab') && CONFIG.EXAM_TYPES_LAB.includes(examType);
    
    if (!isValidTheory && !isValidLab) {
       setUploadStatus({ message: 'Error: Invalid exam type for the selected subject.', type: 'error' });
       return;
    }

    if (!CONFIG.SESSIONS.includes(session)) {
       setUploadStatus({ message: 'Error: Invalid session selected.', type: 'error' });
       return;
    }

    try {
      const uploadData = new FormData();
      uploadData.append('file', file);
      uploadData.append('subject', subject);
      uploadData.append('examType', examType);
      uploadData.append('session', session);
      uploadData.append('year', year);

      setUploadStatus({ message: 'Uploading...', type: 'loading' });

      // Determine if they are an admin doing a direct upload or public
      const headers = Object.assign({},
        (isAdminRoute && adminToken) ? { 'Authorization': `Bearer ${adminToken}` } : { 'Authorization': `Bearer ${ANON_KEY}` }
      );

      const response = await fetch(`${API_URL}?action=upload`, {
        method: 'POST',
        headers: headers,
        body: uploadData
      });

      const result = await response.json();

      if (!response.ok) {
        setUploadStatus({ message: result.error || 'Upload failed.', type: 'error' });
        return;
      }
      
      setUploadStatus({ message: isAdminRoute && adminToken
        ? 'Uploaded successfully!'
        : '✓ Submitted for review. An admin will approve your paper shortly.',
        type: 'success' });
      setTimeout(() => { 
        setIsUploadModalOpen(false); 
        fetchRepoFiles();
        if (isAdminRoute && adminToken) fetchQueue();
        setUploadStatus({ message: '', type: '' }); 
      }, 1500);
    } catch (e) { 
      console.error(e);
      setUploadStatus({ message: 'Upload failed.', type: 'error' }); 
    }
  };

  if (!window.pdfjsLib) return (
    <div className="h-screen bg-cyber-black flex items-center justify-center font-mono text-cyber-accent">
      <RefreshCw className="animate-spin mr-3" size={20} />
      <span>Loading Cyber Archive...</span>
    </div>
  );

  return (
    <div className={`flex h-screen bg-cyber-black text-cyber-text-primary overflow-hidden font-hack relative ${isAdminRoute ? 'theme-admin' : ''}`}>
      <div className="noise" />
      
      {/* Mobile Sidebar Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 flex flex-col border-r border-white/5 bg-cyber-darker
        transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0 md:w-80 md:flex-shrink-0 md:z-30
      `}>
        <div className="p-4 md:p-6">
          <div className="flex items-center justify-between mb-6 md:mb-8">
            <div className="flex items-center gap-3">
              <Archive className="text-cyber-accent" size={24} />
              <h1 className="text-lg md:text-xl font-bold tracking-tight text-white">Cyber Archive</h1>
            </div>
            <button 
              className="md:hidden p-2 rounded-xl hover:bg-white/5 text-cyber-text-secondary hover:text-white transition-all"
              onClick={() => setIsSidebarOpen(false)}
            >
              <X size={20} />
            </button>
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

        {/* Filter Pills */}
        <div className="px-4 md:px-6 pb-3">
          {isLoading ? (
             <div className="flex gap-1.5 mb-2 mt-2">
                <motion.div animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ repeat: Infinity, duration: 1.5 }} className="h-6 w-20 bg-white/5 rounded-lg border border-white/5" />
                <motion.div animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="h-6 w-20 bg-white/5 rounded-lg border border-white/5" />
                <motion.div animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="h-6 w-16 bg-white/5 rounded-lg border border-white/5" />
             </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {['Sessional-1', 'Sessional-2', 'Finals'].map(t => (
                <button
                  key={t}
                  onClick={() => setFilterExamType(prev => prev === t ? '' : t)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide transition-all border ${
                    filterExamType === t
                      ? 'bg-cyber-accent text-white border-cyber-accent shadow-sm shadow-cyber-accent/30'
                      : 'bg-white/5 text-cyber-text-secondary border-white/5 hover:border-cyber-accent/30 hover:text-white'
                  }`}
                >{t}</button>
              ))}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => setFilterExamType('')}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide transition-all border border-red-500/20 text-red-400 hover:bg-red-500/10 flex items-center gap-1 ml-auto"
                >
                  <X size={9} /> Clear
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6 custom-scrollbar">
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

          {/* Queued files section (admin only) */}
          {isAdminRoute && adminToken && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3 px-1">
                <ShieldAlert size={13} className="text-yellow-400" />
                <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-yellow-400">Pending Review</span>
                {queuedFiles.length > 0 && (
                  <span className="ml-auto bg-yellow-400 text-black text-[9px] font-black px-2 py-0.5 rounded-full">{queuedFiles.length}</span>
                )}
              </div>
              {queuedFiles.length === 0 ? (
                <p className="text-[10px] text-cyber-text-secondary/50 px-1 italic">No papers pending review.</p>
              ) : (
                <div className="space-y-1">
                  {queuedFiles.map(qf => (
                    <div
                      key={qf.id}
                      className={`flex items-center gap-2 py-2 px-3 rounded-xl transition-all group cursor-pointer
                        ${currentFile?.path === qf.path && currentFile?._isQueued ? 'bg-yellow-400/10 border border-yellow-400/20' : 'hover:bg-white/5 border border-transparent'}`}
                    >
                      <div className="flex-1 min-w-0" onClick={() => handleQueuePreview(qf)}>
                        <p className="text-[10px] font-bold text-yellow-300 truncate">{qf.name.replace('.pdf', '')}</p>
                        <p className="text-[9px] text-cyber-text-secondary/60 truncate">{qf.subject} · {qf.session} {qf.year}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => { setQueueAction({ file: qf, type: 'approve' }); setQueueStatus({ message: '', type: '' }); }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"
                          title="Approve"
                        >
                          <svg size={12} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                        </button>
                        <button
                          onClick={() => { setQueueAction({ file: qf, type: 'reject' }); setQueueStatus({ message: '', type: '' }); }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                          title="Reject"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isAdminRoute ? (
           <div className="p-4 md:p-6 border-t border-white/5 bg-cyber-darker space-y-2">
               <button 
                 onClick={() => setIsUploadModalOpen(true)} 
                 disabled={isLoading || !!fetchError}
                 className={`cyber-btn-primary w-full py-3.5 tracking-wide h-12 flex items-center justify-center gap-2 ${isLoading || fetchError ? 'opacity-30 grayscale cursor-not-allowed shadow-none' : ''}`}
               >
                   {isLoading ? <RefreshCw size={18} className="animate-spin text-white/50" /> : <Plus size={18} />}
                   <span>{isLoading ? 'Scanning...' : 'Upload Paper'}</span>
               </button>
               {adminToken ? (
                 <div className="flex gap-2">
                   <button 
                     onClick={() => setIsPasswordModalOpen(true)}
                     className="flex-1 py-2 text-[10px] font-bold tracking-widest uppercase border border-white/5 rounded-xl hover:bg-white/5 text-cyber-text-secondary hover:text-white transition-colors flex items-center justify-center gap-1.5"
                   >
                     <Key size={12} /> Password
                   </button>
                   <button 
                     onClick={handleLogout}
                     className="flex-1 py-2 text-[10px] font-bold tracking-widest uppercase border border-red-500/10 rounded-xl hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors flex items-center justify-center gap-1.5"
                   >
                     <LogOut size={12} /> Logout
                   </button>
                 </div>
               ) : (
                <button 
                  onClick={() => setIsLoginModalOpen(true)}
                  className="w-full py-3 flex items-center justify-center gap-2 text-xs font-bold tracking-wide uppercase text-cyber-text-secondary hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/5"
                >
                  <Lock size={14} /> Admin Login
                </button>
               )}
           </div>
        ) : (
          <div className="p-4 md:p-6 border-t border-white/5 bg-cyber-darker">
              <button 
                onClick={() => setIsUploadModalOpen(true)} 
                disabled={isLoading || !!fetchError}
                className={`cyber-btn-primary w-full py-3.5 tracking-wide h-12 flex items-center justify-center gap-2 ${isLoading || fetchError ? 'opacity-30 grayscale cursor-not-allowed shadow-none' : ''}`}
              >
                  {isLoading ? <RefreshCw size={18} className="animate-spin text-white/50" /> : <Plus size={18} />}
                  <span>{isLoading ? 'Scanning Archive...' : 'Contribute Paper'}</span>
              </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col min-w-0 bg-cyber-black">
        {/* Mobile hamburger */}
        <button 
          className="md:hidden fixed top-4 left-4 z-30 w-10 h-10 flex items-center justify-center rounded-xl bg-cyber-darker border border-white/10 text-cyber-text-secondary hover:text-white transition-all shadow-lg"
          onClick={() => setIsSidebarOpen(true)}
        >
          <Menu size={20} />
        </button>

        <AnimatePresence mode="wait">
          {!currentFile ? (
            <motion.div key="welcome" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 text-center">
              <div className="w-20 h-20 md:w-28 md:h-28 mb-6 md:mb-8 rounded-[2rem] md:rounded-[2.5rem] bg-cyber-accent/10 flex items-center justify-center text-4xl md:text-5xl shadow-inner border border-cyber-accent/20">
                📚
              </div>
              <h2 className="text-2xl md:text-4xl font-black mb-3 md:mb-4 tracking-tight text-white uppercase">Cyber Archive</h2>
              <p className="text-cyber-text-secondary max-w-sm mx-auto mb-6 md:mb-8 leading-relaxed text-xs md:text-sm font-medium">
                Contribute to this repo by uploading if not uploaded already. Select a file from the sidebar to view.
              </p>
            </motion.div>
          ) : (
            <motion.div key="viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col min-h-0">
              <header className="flex items-center justify-between px-4 py-3 md:px-10 md:py-6 border-b border-white/5 bg-cyber-darker/50 backdrop-blur-md relative z-20">
                <div className="flex items-center gap-3 md:gap-5 min-w-0 ml-12 md:ml-0">
                  <div className={`w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center border shadow-lg shrink-0 ${
                    currentFile._isQueued
                      ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 shadow-yellow-500/5'
                      : 'bg-cyber-accent/10 text-cyber-accent border-cyber-accent/20 shadow-cyber-accent/5'
                  }`}>
                    <FileText size={18} className="md:hidden" />
                    <FileText size={22} className="hidden md:block" />
                  </div>
                  <div className="min-w-0">
                    <h3 className={`font-bold text-xs md:text-sm truncate uppercase tracking-tight ${
                      currentFile._isQueued ? 'text-yellow-300' : 'text-white'
                    }`}>{currentFile.name.replace('.pdf', '')}</h3>
                    {currentFile._isQueued && <p className="text-[9px] text-yellow-500/70 font-bold tracking-widest uppercase mt-0.5">Pending Review</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 md:gap-3 shrink-0">
                  {isAdminRoute && adminToken && currentFile._isQueued ? (
                    // Show approve/reject buttons in header when previewing a queued file
                    <div className="flex items-center gap-2 mr-1">
                      <motion.button
                        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all text-[10px] font-bold tracking-widest uppercase border border-emerald-500/20"
                        onClick={() => { setQueueAction({ file: currentFile, type: 'approve' }); setQueueStatus({ message: '', type: '' }); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                        Approve
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all text-[10px] font-bold tracking-widest uppercase border border-red-500/20"
                        onClick={() => { setQueueAction({ file: currentFile, type: 'reject' }); setQueueStatus({ message: '', type: '' }); }}
                      >
                        <X size={12} /> Reject
                      </motion.button>
                    </div>
                  ) : isAdminRoute && adminToken && (
                     <motion.button 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-lg border border-red-500/20 mr-1" 
                        onClick={() => requestDelete(currentFile)} 
                        title="Delete Permanently"
                     >
                        <Trash2 size={16} className="md:hidden" />
                        <Trash2 size={18} className="hidden md:block" />
                     </motion.button>
                  )}
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-xl bg-cyber-accent text-white shadow-[0_0_20px_rgba(232,17,122,0.3)] hover:shadow-[0_0_25px_rgba(232,17,122,0.5)] transition-all" 
                    onClick={() => { 
                      const a = document.createElement('a'); 
                      a.href = currentFile.blobUrl; 
                      a.download = currentFile.name; 
                      document.body.appendChild(a);
                      a.click(); 
                      document.body.removeChild(a);
                    }} 
                    title="Download"
                  >
                    <motion.div
                      animate={{ y: [0, 2, 0] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                    >
                      <FileDown size={16} className="md:hidden" />
                      <FileDown size={18} className="hidden md:block" />
                    </motion.div>
                  </motion.button>
                  <div className="h-4 w-px bg-white/10 mx-0.5 md:mx-1" />
                  <button className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/10" 
                    onClick={() => {
                        if (currentFile?.blobUrl) URL.revokeObjectURL(currentFile.blobUrl);
                        setCurrentFile(null);
                    }}
                  ><X size={16} className="md:hidden" /><X size={18} className="hidden md:block" /></button>
                </div>
              </header>

              <div ref={viewerRef} className="flex-1 overflow-auto p-4 md:p-12 lg:p-20 custom-scrollbar bg-[#05070a]">
                {(!pdfRef || isLoadingQueue) ? (
                  <div className="h-full flex items-center justify-center text-cyber-text-secondary">
                    <RefreshCw size={24} className="animate-spin mr-3 opacity-20" />
                    <span>Loading Document...</span>
                  </div>
                ) : (
                  <div className="max-w-fit mx-auto flex flex-col items-center">
                    {[...Array(pdfRef.numPages)].map((_, i) => (
                      <PDFPage key={`${currentFile.path}-${i}`} pdf={pdfRef} pageNum={i + 1} scale={isMobile ? displayScale * 0.5 : displayScale} />
                    ))}
                  </div>
                )}
              </div>

              <footer className="px-4 py-3 md:px-10 md:py-5 border-t border-white/5 bg-cyber-darker/50 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 text-[11px] text-cyber-text-secondary">
                <div className="font-bold uppercase tracking-widest opacity-60">
                    Total Pages: {pdfRef?.numPages || 0}
                </div>
                <div className="flex items-center gap-4 md:gap-8">
                  <div className="flex items-center gap-3 md:gap-4">
                    <input 
                      type="range" min="0" max="200" step="1" value={Math.round((displayScale - 1) * 100)} 
                      className="w-28 md:w-40 h-1 bg-white/5 rounded-full accent-cyber-accent appearance-none cursor-pointer" 
                      onChange={(e) => setDisplayScale(1 + (parseInt(e.target.value) / 100))} 
                    />
                    <span className="min-w-[45px] font-mono text-cyber-accent font-black tabular-nums">{Math.round((displayScale - 1) * 100)}%</span>
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm" onClick={() => setIsUploadModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-[95vw] sm:max-w-lg bg-cyber-darker border border-white/5 shadow-2xl rounded-2xl sm:rounded-[2rem] p-5 sm:p-8 relative overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyber-accent/10 blur-[80px]" />
              
              <div className="flex items-center justify-between mb-6 sm:mb-10">
                <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-cyber-accent flex items-center justify-center shadow-lg shadow-cyber-accent/20">
                        <Plus className="text-white" size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">Upload Document</h2>
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

              <form onSubmit={handleUpload} className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Subject</label>
                    <select id="subject-select" name="subject" required className="cyber-input appearance-none" onChange={(e) => {
                      const isLab = e.target.value.toLowerCase().includes('lab');
                      const typeSelect = document.getElementById('exam-type-select');
                      if (typeSelect) {
                        typeSelect.innerHTML = '';
                        const options = isLab ? CONFIG.EXAM_TYPES_LAB : CONFIG.EXAM_TYPES_THEORY;
                        options.forEach(opt => {
                          const option = document.createElement('option');
                          option.value = opt;
                          option.text = opt;
                          typeSelect.appendChild(option);
                        });
                      }
                    }}>
                      <option value="" disabled selected>Select Subject</option>
                      {CONFIG.SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Type</label>
                    <select id="exam-type-select" name="examType" required className="cyber-input appearance-none">
                      <option value="" disabled selected>Select Subject First</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <div className={`p-3 sm:p-4 rounded-xl text-xs font-bold border ${uploadStatus.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/10' : 'bg-green-500/10 text-green-400 border-green-500/10'}`}>
                    {uploadStatus.message}
                  </div>
                )}

                <button type="submit" disabled={uploadStatus.type === 'loading'} className="cyber-btn-primary w-full py-3.5 sm:py-4 text-xs font-bold tracking-[0.2em] uppercase rounded-xl active:scale-95">
                    {uploadStatus.type === 'loading' ? 'Encrypting Payload...' : 'Submit to Archive'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Login Modal */}
      <AnimatePresence>
        {isAdminRoute && isLoginModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm" onClick={() => setIsLoginModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm bg-cyber-darker border border-white/5 shadow-2xl rounded-2xl p-6 sm:p-8" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10">
                        <Lock className="text-cyber-accent" size={20} />
                    </div>
                    <h2 className="text-xl font-bold text-white tracking-tight">Admin Uplink</h2>
                </div>
                <button onClick={() => setIsLoginModalOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-cyber-text-secondary hover:text-white transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Username</label>
                    <input type="text" name="username" required defaultValue="admin" className="cyber-input w-full" />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-cyber-text-secondary uppercase tracking-widest ml-1">Password</label>
                    <input type="password" name="password" required className="cyber-input w-full" />
                </div>
                
                {authStatus.message && (
                  <div className={`p-3 rounded-xl text-xs font-bold border ${authStatus.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/10' : 'bg-white/5 text-white/70 border-white/10'}`}>
                    {authStatus.message}
                  </div>
                )}

                <button type="submit" disabled={authStatus.type === 'loading'} className="cyber-btn-primary w-full py-3.5 mt-2 text-xs font-bold tracking-[0.2em] uppercase rounded-xl">
                    {authStatus.type === 'loading' ? 'Authenticating...' : 'Authorize Login'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Password Update Modal */}
      <AnimatePresence>
        {isPasswordModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm" onClick={() => setIsPasswordModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm bg-cyber-darker border border-red-500/20 shadow-[0_0_50px_rgba(239,68,68,0.1)] rounded-2xl p-6 sm:p-8" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                        <ShieldAlert className="text-red-500" size={20} />
                    </div>
                    <h2 className="text-xl font-bold text-white tracking-tight">Security Update</h2>
                </div>
                <button onClick={() => setIsPasswordModalOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-cyber-text-secondary hover:text-white transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-red-500/70 uppercase tracking-widest ml-1">Username</label>
                    <input type="text" name="username" required defaultValue="admin" className="cyber-input w-full border-red-500/20 focus:border-red-500/50" />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-red-500/70 uppercase tracking-widest ml-1">Current Password</label>
                    <input type="password" name="current_password" required className="cyber-input w-full border-red-500/20 focus:border-red-500/50" />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-red-500/70 uppercase tracking-widest ml-1">New Password</label>
                    <input type="password" name="new_password" required minLength="6" className="cyber-input w-full border-red-500/20 focus:border-red-500/50" />
                </div>
                
                {authStatus.message && (
                  <div className={`p-3 rounded-xl text-xs font-bold border ${authStatus.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/10' : 'bg-green-500/10 text-green-400 border-green-500/10'}`}>
                    {authStatus.message}
                  </div>
                )}

                <p className="text-[10px] text-cyber-text-secondary font-medium leading-relaxed my-4">
                  Changing the password will immediately revoke your current active session. You will be logged out and required to re-authenticate.
                </p>

                <button type="submit" disabled={authStatus.type === 'loading'} className="w-full py-3.5 bg-red-500 hover:bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all mt-2 text-xs font-bold tracking-[0.2em] uppercase rounded-xl">
                    {authStatus.type === 'loading' ? 'Encrypting...' : 'Override Key'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {fileToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm" onClick={() => !deleteStatus.type.includes('loading') && setFileToDelete(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm bg-cyber-darker border border-red-500/20 shadow-[0_0_50px_rgba(239,68,68,0.15)] rounded-2xl p-6 sm:p-8" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                        <AlertTriangle className="text-red-500" size={20} />
                    </div>
                    <h2 className="text-xl font-bold text-white tracking-tight">Confirm Deletion</h2>
                </div>
                {!deleteStatus.type.includes('loading') && (
                  <button onClick={() => setFileToDelete(null)} className="p-2 rounded-xl hover:bg-white/5 text-cyber-text-secondary hover:text-white transition-all">
                    <X size={20} />
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <p className="text-sm text-cyber-text-secondary font-medium leading-relaxed">
                  Are you sure you want to completely purge <span className="text-white font-bold">"{fileToDelete?.name}"</span> from the database and the storage bucket?
                </p>
                <p className="text-xs text-red-400 font-bold bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                  ⚠️ This action is irreversible.
                </p>

                {deleteStatus.message && (
                  <div className={`p-3 rounded-xl text-xs font-bold border ${deleteStatus.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/10' : deleteStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/10' : 'bg-white/5 text-white/70 border-white/10'}`}>
                    {deleteStatus.message}
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button 
                    onClick={() => setFileToDelete(null)} 
                    disabled={deleteStatus.type === 'loading'} 
                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white transition-all text-xs font-bold tracking-widest uppercase rounded-xl border border-white/10"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={executeDelete} 
                    disabled={deleteStatus.type === 'loading'} 
                    className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all text-xs font-bold tracking-widest uppercase rounded-xl"
                  >
                    {deleteStatus.type === 'loading' ? 'Purging...' : 'Delete'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Approve / Reject Confirmation Modal */}
      <AnimatePresence>
        {queueAction && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-cyber-darker border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                  queueAction.type === 'approve' ? 'bg-emerald-500/10' : 'bg-red-500/10'
                }`}>
                  {queueAction.type === 'approve'
                    ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400"><polyline points="20 6 9 17 4 12" /></svg>
                    : <AlertTriangle size={22} className="text-red-400" />
                  }
                </div>
                <div>
                  <h2 className="text-white font-black text-lg uppercase tracking-tight">
                    {queueAction.type === 'approve' ? 'Approve Paper' : 'Reject Paper'}
                  </h2>
                  <p className="text-cyber-text-secondary text-xs mt-1">
                    {queueAction.type === 'approve'
                      ? 'This paper will be moved to the live archive and visible to all users.'
                      : 'This paper will be permanently deleted and cannot be recovered.'}
                  </p>
                  <p className="text-white/60 text-[10px] mt-3 font-mono bg-white/5 rounded-lg px-3 py-2 border border-white/5 truncate">{queueAction.file.name}</p>
                </div>
              </div>

              {queueStatus.message && (
                <div className={`mb-4 p-3 rounded-xl text-xs font-bold text-center ${
                  queueStatus.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                  queueStatus.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                  'bg-white/5 text-white/60 border border-white/5'
                }`}>
                  {queueStatus.message}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setQueueAction(null)}
                  disabled={queueStatus.type === 'loading'}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white transition-all text-xs font-bold tracking-widest uppercase rounded-xl border border-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={executeQueueAction}
                  disabled={queueStatus.type === 'loading'}
                  className={`flex-1 py-3 text-white transition-all text-xs font-bold tracking-widest uppercase rounded-xl ${
                    queueAction.type === 'approve'
                      ? 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                      : 'bg-red-500 hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
                  }`}
                >
                  {queueStatus.type === 'loading' ? '...' : queueAction.type === 'approve' ? 'Approve' : 'Reject'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
