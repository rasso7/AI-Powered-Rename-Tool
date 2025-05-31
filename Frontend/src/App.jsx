import React, { useState, useCallback } from 'react';
import { Upload, Brain, Download, Trash2, Edit3, Check, X, Sparkles, Zap, Shield } from 'lucide-react';
import MainImg from './assets/main.jpg'
const API_BASE = 'http://localhost:8000';

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState('idle'); // idle, uploading, analyzing, completed
  const [dragActive, setDragActive] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState(null);

  // Clear error when starting new actions
  const clearError = () => setError(null);

  // File upload handlers
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  }, []);

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (files) => {
    clearError();
    setStatus('uploading');
    
    console.log('Starting upload with files:', files.length);
    
    const formData = new FormData();
    let imageCount = 0;
    
    Array.from(files).forEach(file => {
      console.log('Processing file:', file.name, 'Type:', file.type);
      if (file.type.startsWith('image/')) {
        formData.append('files', file);
        imageCount++;
      }
    });

    if (imageCount === 0) {
      setError('No valid image files selected. Please select PNG, JPG, or JPEG files.');
      setStatus('idle');
      return;
    }

    console.log('Uploading', imageCount, 'image files');

    try {
      console.log('Making upload request to:', `${API_BASE}/upload`);
      
      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Response error text:', errorText);
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { detail: errorText || 'Upload failed' };
        }
        
        throw new Error(errorData.detail || `Upload failed with status ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Upload response:', data);
      
      if (!data.session_id) {
        throw new Error('Invalid response: missing session_id');
      }
      
      setSessionId(data.session_id);
      setImages(data.images || []);
      setStatus('uploaded');
    } catch (error) {
      console.error('Upload error:', error);
      
      let errorMessage = error.message;
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Cannot connect to server. Please make sure the backend is running on http://localhost:8000';
      }
      
      setError(`Upload failed: ${errorMessage}`);
      setStatus('error');
    }
  };

  const analyzeImages = async () => {
    if (!sessionId) return;
    
    clearError();
    setStatus('analyzing');
    
    console.log('Starting analysis for session:', sessionId);

    try {
      const response = await fetch(`${API_BASE}/analyze/${sessionId}`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Analysis failed' }));
        throw new Error(errorData.detail || `Analysis failed with status ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Analysis response:', data);
      
      setImages(data.images);
      setStatus('analyzed');
    } catch (error) {
      console.error('Analysis error:', error);
      setError(`Analysis failed: ${error.message}`);
      setStatus('error');
    }
  };

  const renameImages = async () => {
    if (!sessionId) return;
    
    clearError();
    setStatus('renaming');
    
    const renameData = images.map(img => ({
      id: img.id,
      new_name: img.suggested_name || img.original_name.split('.')[0]
    }));

    console.log('Renaming images:', renameData);

    try {
      const response = await fetch(`${API_BASE}/rename/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ images: renameData }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Rename failed' }));
        throw new Error(errorData.detail || `Rename failed with status ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Rename response:', data);
      
      setStatus('completed');
    } catch (error) {
      console.error('Rename error:', error);
      setError(`Rename failed: ${error.message}`);
      setStatus('error');
    }
  };

  const downloadImages = async () => {
    if (!sessionId) return;
    
    clearError();
    
    try {
      const response = await fetch(`${API_BASE}/download/${sessionId}`);
      
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'renamed_images.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      setError(`Download failed: ${error.message}`);
    }
  };

  const startNewSession = async () => {
    if (sessionId) {
      try {
        await fetch(`${API_BASE}/session/${sessionId}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
    
    setSessionId(null);
    setImages([]);
    setStatus('idle');
    setEditingId(null);
    setError(null);
  };

  const startEdit = (imageId, currentName) => {
    setEditingId(imageId);
    setEditValue(currentName);
  };

  const saveEdit = () => {
    setImages(images.map(img => 
      img.id === editingId 
        ? { ...img, suggested_name: editValue }
        : img
    ));
    setEditingId(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-lg border-b border-white/20 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">RenameAI</span>
            </div>
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <Shield className="w-4 h-4" />
                <span>100% Secure</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <Zap className="w-4 h-4" />
                <span>Lightning Fast</span>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-4rem)]">
        {/* Left Side - Hero Section */}
        <div className="w-full lg:w-1/2 relative overflow-hidden">
          <div className="flex flex-col items-center justify-center min-h-full p-6 lg:p-8 ">
            {/* Hero Image */}
            <div className="mb-8 lg:mb-6">
              <img 
                src={MainImg}
                alt="AI Technology" 
                className="w-80 h-80 object-cover rounded-2xl shadow-2xl"
              />
            </div>
            
            {/* Hero Text */}
            <div className="text-center text-black max-w-lg">
              <h1 className="text-4xl lg:text-6xl font-bold mb-6 leading-tight">
                AI-Powered
                <br />
                <span className="bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
                  Image Renaming
                </span>
              </h1>
              <p className="text-lg lg:text-xl opacity-90 mb-8 text-black">
                Transform your messy image files into perfectly organized, descriptively named assets in seconds.
              </p>
              <div className="flex flex-wrap gap-4 justify-center">
                <div className="flex items-center space-x-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2">
                  <Sparkles className="w-4 h-4" />
                  <span className="text-sm font-medium">Smart AI Analysis</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm font-medium">Batch Processing</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Upload & Processing Area */}
        <div className="w-full lg:w-1/2 bg-white flex flex-col">
          <div className="flex-1 p-6 lg:p-12 flex flex-col justify-center">
            {/* Error Display */}
            {error && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-2xl shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-1 bg-red-100 rounded-full flex-shrink-0">
                    <X className="w-5 h-5 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-red-800 font-medium">{error}</p>
                  </div>
                  <button 
                    onClick={clearError} 
                    className="p-1 hover:bg-red-100 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-red-400" />
                  </button>
                </div>
              </div>
            )}

            {status === 'idle' && (
              <div className="space-y-8">
                <div className="text-center">
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">Get Started</h2>
                  <p className="text-gray-600 text-lg mb-8">
                    Upload your images and let our AI generate perfect filenames automatically.
                  </p>
                </div>

                <div
                  className={`relative group cursor-pointer transition-all duration-300 ${
                    dragActive 
                      ? 'scale-[1.02] shadow-2xl' 
                      : 'hover:scale-[1.01] hover:shadow-xl'
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <div className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all duration-300 ${
                    dragActive 
                      ? 'border-blue-400 bg-blue-50 shadow-lg' 
                      : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                  }`}>
                    <div className="mb-8">
                      <div className="inline-block p-6 bg-gradient-to-r from-blue-600 to-purple-600 rounded-3xl mb-6 shadow-lg">
                        <Upload className="w-10 h-10 text-white" />
                      </div>
                      <button className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-4 px-8 rounded-2xl text-lg transition-all duration-300 shadow-lg hover:shadow-xl">
                        Choose Images
                      </button>
                    </div>
                    <div className="space-y-3 text-gray-600">
                      <p className="font-medium text-lg">or drag and drop files here</p>
                      <p className="text-sm">Supports PNG, JPG, JPEG • Multiple files welcome</p>
                      <p className="text-xs text-gray-500">Your files are processed securely and never stored</p>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleFileInput}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
                      <Upload className="w-6 h-6 text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">1. Upload</h3>
                    <p className="text-sm text-gray-600">Select your images</p>
                  </div>
                  <div className="p-4">
                    <div className="w-12 h-12 bg-purple-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
                      <Brain className="w-6 h-6 text-purple-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">2. Analyze</h3>
                    <p className="text-sm text-gray-600">AI processes content</p>
                  </div>
                  <div className="p-4">
                    <div className="w-12 h-12 bg-green-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
                      <Download className="w-6 h-6 text-green-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">3. Download</h3>
                    <p className="text-sm text-gray-600">Get renamed files</p>
                  </div>
                </div>
              </div>
            )}

            {status === 'uploading' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">Uploading Images</h3>
                  <p className="text-gray-600">Securely transferring your files...</p>
                </div>
              </div>
            )}

            {status === 'uploaded' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-green-100 rounded-full mx-auto flex items-center justify-center">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                    {images.length} Images Ready
                  </h3>
                  <p className="text-gray-600 mb-8">Files uploaded successfully. Ready for AI analysis!</p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button 
                      className="flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300"
                      onClick={analyzeImages}
                    >
                      <Brain className="w-5 h-5" />
                      Start AI Analysis
                    </button>
                    <button 
                      className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-2xl transition-all duration-300"
                      onClick={startNewSession}
                    >
                      Upload Different Images
                    </button>
                  </div>
                </div>
              </div>
            )}

            {status === 'analyzing' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto"></div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">AI Analysis in Progress</h3>
                  <p className="text-gray-600">Our AI is examining your images and generating descriptive names...</p>
                  <div className="mt-4 text-sm text-gray-500">This usually takes 10-30 seconds</div>
                </div>
              </div>
            )}

            {status === 'analyzed' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-purple-100 rounded-full mx-auto flex items-center justify-center">
                  <Brain className="w-8 h-8 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">Analysis Complete!</h3>
                  <p className="text-gray-600 mb-8">Review the AI-generated names below. You can edit any suggestions before processing.</p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button 
                      className="flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300"
                      onClick={renameImages}
                    >
                      <Download className="w-5 h-5" />
                      Process & Download
                    </button>
                    <button 
                      className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-2xl transition-all duration-300"
                      onClick={startNewSession}
                    >
                      <Trash2 className="w-5 h-5" />
                      Start Over
                    </button>
                  </div>
                </div>
              </div>
            )}

            {status === 'renaming' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mx-auto"></div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">Processing Images</h3>
                  <p className="text-gray-600">Applying the new names and preparing your download...</p>
                </div>
              </div>
            )}

            {status === 'completed' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-green-100 rounded-full mx-auto flex items-center justify-center">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">Success!</h3>
                  <p className="text-gray-600 mb-8">Your images have been processed and are ready for download.</p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button 
                      className="flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300"
                      onClick={downloadImages}
                    >
                      <Download className="w-5 h-5" />
                      Download ZIP
                    </button>
                    <button 
                      className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-2xl transition-all duration-300"
                      onClick={startNewSession}
                    >
                      Process More Images
                    </button>
                  </div>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-red-100 rounded-full mx-auto flex items-center justify-center">
                  <X className="w-8 h-8 text-red-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">Something went wrong</h3>
                  <p className="text-gray-600 mb-8">Don't worry, you can try again with the same or different images.</p>
                  <button 
                    className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-2xl transition-all duration-300 mx-auto"
                    onClick={startNewSession}
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Images Grid - Full Width Below */}
      {status === 'analyzed' && images.length > 0 && (
        <div className="bg-white border-t border-gray-100">
          <div className="max-w-7xl mx-auto p-8">
            <div className="text-center mb-8">
              <h4 className="text-2xl font-bold text-gray-900 mb-2">Review AI Suggestions</h4>
              <p className="text-gray-600">Click the edit icon to customize any filename before processing</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {images.map((image) => (
                <div key={image.id} className="bg-white rounded-2xl p-6 border border-gray-200 hover:shadow-lg hover:border-gray-300 transition-all duration-300">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <span className="text-sm font-medium text-gray-500">Original:</span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-lg font-medium">
                          {formatFileSize(image.size)}
                        </span>
                      </div>
                      <p className="text-gray-800 font-medium break-all text-sm bg-gray-50 p-3 rounded-lg">{image.original_name}</p>
                    </div>
                    
                    <div className="pt-2 border-t border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-500">AI Suggestion:</span>
                        <span className={`px-2 py-1 text-xs rounded-lg font-medium ${
                          image.status === 'completed' 
                            ? 'bg-green-100 text-green-700' 
                            : image.status === 'error'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {image.status}
                        </span>
                      </div>
                      
                      {editingId === image.id ? (
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button 
                              className="flex items-center justify-center p-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors"
                              onClick={saveEdit}
                            >
                              <Check size={14} />
                            </button>
                            <button 
                              className="flex items-center justify-center p-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors"
                              onClick={cancelEdit}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-gray-800 font-medium flex-1 break-all text-sm bg-blue-50 p-3 rounded-lg">
                            {image.suggested_name || 'Processing...'}
                          </p>
                          {image.suggested_name && (
                            <button
                              className="p-2 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors flex-shrink-0"
                              onClick={() => startEdit(image.id, image.suggested_name)}
                            >
                              <Edit3 size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {image.status === 'error' && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-700 text-xs font-medium">
                          Error: {image.error || 'Analysis failed'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;