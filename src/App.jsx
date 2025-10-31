import {
  AlertCircle,
  BarChart3,
  Check,
  Clock,
  Download,
  Eye,
  File,
  FileText,
  Globe,
  HardDrive,
  Image,
  Info,
  Loader,
  Lock,
  Music,
  Network,
  Pause,
  Play,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Trash2,
  Upload,
  User,
  Video,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const App = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileType, setFileType] = useState("video");
  const [customPath, setCustomPath] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("idle");
  const [uploadId, setUploadId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [config, setConfig] = useState(null);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploadStrategy, setUploadStrategy] = useState("auto");
  const [retryCount, setRetryCount] = useState(0);
  const [failedChunks, setFailedChunks] = useState([]);
  const [chunkProgress, setChunkProgress] = useState({});
  const [activeTab, setActiveTab] = useState("upload");
  const [stats, setStats] = useState({
    totalUploads: 0,
    totalSize: 0,
    averageSpeed: 0,
  });

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    fetchConfig();
    loadUploadedFiles();
    loadStats();
  }, []);

  useEffect(() => {
    if (selectedFile) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [selectedFile]);

  const addLog = (message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) =>
      [
        {
          id: Date.now() + Math.random(),
          message,
          type,
          timestamp,
        },
        ...prev,
      ].slice(0, 200)
    );
  };

  const fetchConfig = async () => {
    try {
      addLog("Fetching server configuration...", "info");
      const response = await fetch(`${API_BASE_URL}/files/config`);
      const data = await response.json();

      if (data.responseCode === "00") {
        setConfig(data.data);
        addLog("Configuration loaded successfully", "success");
      } else {
        throw new Error(data.responseMessage || "Failed to load config");
      }
    } catch (error) {
      addLog(`Failed to load config: ${error.message}`, "error");
    }
  };

  const loadUploadedFiles = () => {
    const stored = localStorage.getItem("uploadedFiles");
    if (stored) {
      try {
        const files = JSON.parse(stored);
        setUploadedFiles(files);
        addLog(`Loaded ${files.length} uploaded files from storage`, "info");
      } catch (error) {
        console.error("Failed to load uploaded files:", error);
        addLog("Failed to load uploaded files from storage", "error");
      }
    }
  };

  const loadStats = () => {
    const stored = localStorage.getItem("uploadStats");
    if (stored) {
      try {
        setStats(JSON.parse(stored));
      } catch (error) {
        console.error("Failed to load stats:", error);
      }
    }
  };

  const saveStats = (newFileSize = 0) => {
    const newStats = {
      totalUploads: stats.totalUploads + 1,
      totalSize: stats.totalSize + newFileSize,
      averageSpeed: stats.averageSpeed,
    };
    setStats(newStats);
    localStorage.setItem("uploadStats", JSON.stringify(newStats));
  };

  const saveUploadedFile = (fileData) => {
    const updated = [fileData, ...uploadedFiles].slice(0, 50);
    setUploadedFiles(updated);
    localStorage.setItem("uploadedFiles", JSON.stringify(updated));
    saveStats(fileData.file_size || 0);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Reset state for new file
    setSelectedFile(file);
    setUploadProgress(0);
    setUploadStatus("idle");
    setCurrentChunk(0);
    setTotalChunks(0);
    setRetryCount(0);
    setFailedChunks([]);
    setChunkProgress({});

    const type = file.type.split("/")[0];
    if (["image", "video", "audio"].includes(type)) {
      setFileType(type);
    } else {
      setFileType("document");
    }

    addLog(`File selected: ${file.name} (${formatBytes(file.size)})`, "info");

    // Auto-detect upload strategy
    const threshold = config?.chunkSize || 10 * 1024 * 1024;
    if (uploadStrategy === "auto") {
      setUploadStrategy(file.size > threshold ? "chunked" : "direct");
    }
  };

  const initializeUpload = async () => {
    try {
      addLog("Initializing upload session...", "info");
      const response = await fetch(`${API_BASE_URL}/files/chunk/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_type: fileType,
          file_size: selectedFile.size,
          filename: selectedFile.name,
          custom_path: customPath || null,
          visibility: visibility,
        }),
      });

      const data = await response.json();

      if (data.responseCode !== "00") {
        throw new Error(data.responseMessage || "Initialization failed");
      }

      setUploadId(data.data.uploadId);
      setTotalChunks(data.data.totalChunks);

      addLog(
        `Upload initialized: ${data.data.totalChunks} chunks required`,
        "success"
      );
      addLog(`Chunk size: ${formatBytes(data.data.chunk_size)}`, "info");

      return data.data;
    } catch (error) {
      addLog(`Initialization failed: ${error.message}`, "error");
      throw error;
    }
  };

  const uploadChunk = async (
    chunk,
    index,
    uploadId,
    totalChunks,
    retry = 0
  ) => {
    const maxRetries = 3;

    try {
      const formData = new FormData();
      formData.append("chunk", chunk);
      formData.append("upload_id", uploadId);
      formData.append("chunk_index", index);
      formData.append("total_chunks", totalChunks);
      formData.append("file_type", fileType);
      formData.append("original_filename", selectedFile.name);
      if (customPath) formData.append("custom_path", customPath);

      abortControllerRef.current = new AbortController();

      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/files/chunk/upload`, {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();
      const endTime = Date.now();
      const speed = chunk.size / ((endTime - startTime) / 1000);

      if (data.responseCode !== "00" && data.responseCode !== "CREATED") {
        throw new Error(data.responseMessage || "Chunk upload failed");
      }

      // Update chunk progress
      setChunkProgress((prev) => ({
        ...prev,
        [index]: { status: "completed", speed },
      }));

      addLog(
        `Chunk ${index + 1}/${totalChunks} uploaded (${formatBytes(speed)}/s)`,
        "success"
      );

      return data.data;
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }

      if (retry < maxRetries) {
        addLog(
          `Retrying chunk ${index + 1} (attempt ${retry + 1}/${maxRetries})`,
          "warning"
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
        return uploadChunk(chunk, index, uploadId, totalChunks, retry + 1);
      } else {
        setFailedChunks((prev) => [...prev, index]);
        setChunkProgress((prev) => ({
          ...prev,
          [index]: { status: "failed" },
        }));
        throw new Error(
          `Failed to upload chunk ${index + 1} after ${maxRetries} attempts`
        );
      }
    }
  };

  const handleChunkedUpload = async () => {
    setUploadStatus("uploading");
    setUploadProgress(0);
    setFailedChunks([]);

    try {
      const initData = await initializeUpload();
      const chunkSize = config?.chunkSize || 2097152;
      const chunks = Math.ceil(selectedFile.size / chunkSize);

      addLog(
        `Starting chunked upload: ${chunks} chunks, ${formatBytes(
          chunkSize
        )} each`,
        "info"
      );

      for (let i = 0; i < chunks; i++) {
        // Skip if this chunk was successfully uploaded in a previous attempt
        if (chunkProgress[i]?.status === "completed") {
          continue;
        }

        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, selectedFile.size);
        const chunk = selectedFile.slice(start, end);

        setCurrentChunk(i + 1);
        setChunkProgress((prev) => ({
          ...prev,
          [i]: { status: "uploading" },
        }));

        try {
          const result = await uploadChunk(
            chunk,
            i,
            initData.uploadId,
            initData.totalChunks
          );

          const progress = ((i + 1) / chunks) * 100;
          setUploadProgress(progress);

          if (result.complete) {
            setUploadStatus("completed");
            addLog(`Upload completed: ${result.fileName}`, "success");
            saveUploadedFile(result);

            // Show completion summary
            addLog(
              `Total chunks: ${chunks}, Total size: ${formatBytes(
                selectedFile.size
              )}`,
              "info"
            );
            return;
          }
        } catch (error) {
          if (error.name === "AbortError") {
            throw error;
          }
          // Continue with next chunk even if one fails (will retry later)
          addLog(
            `Chunk ${i + 1} failed, will retry later: ${error.message}`,
            "error"
          );
        }
      }

      // Check if we have failed chunks to retry
      if (failedChunks.length > 0) {
        setRetryCount((prev) => prev + 1);
        addLog(
          `Retrying ${failedChunks.length} failed chunks (attempt ${
            retryCount + 1
          })`,
          "warning"
        );
        await handleRetryFailedChunks(
          initData.uploadId,
          initData.totalChunks,
          chunkSize
        );
      }
    } catch (error) {
      if (error.name === "AbortError") {
        setUploadStatus("cancelled");
        addLog("Upload cancelled by user", "warning");
      } else {
        setUploadStatus("error");
        addLog(`Upload failed: ${error.message}`, "error");
      }
    }
  };

  const handleRetryFailedChunks = async (uploadId, totalChunks, chunkSize) => {
    const chunksToRetry = [...failedChunks];
    setFailedChunks([]);

    for (const chunkIndex of chunksToRetry) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, selectedFile.size);
      const chunk = selectedFile.slice(start, end);

      setChunkProgress((prev) => ({
        ...prev,
        [chunkIndex]: { status: "retrying" },
      }));

      try {
        await uploadChunk(chunk, chunkIndex, uploadId, totalChunks);
        // Remove from failed chunks if successful
        setFailedChunks((prev) => prev.filter((idx) => idx !== chunkIndex));
      } catch (error) {
        // Keep in failed chunks
        addLog(
          `Chunk ${chunkIndex + 1} still failing: ${error.message}`,
          "error"
        );
      }
    }

    // If still have failed chunks after retry
    if (failedChunks.length > 0) {
      setUploadStatus("error");
      addLog(
        `Upload incomplete: ${failedChunks.length} chunks failed`,
        "error"
      );
    } else {
      setUploadStatus("completed");
      addLog("All chunks uploaded successfully after retry", "success");
    }
  };

  const handleDirectUpload = async () => {
    setUploadStatus("uploading");
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("file_type", fileType);
      if (customPath) formData.append("custom_path", customPath);
      formData.append("visibility", visibility);

      addLog("Starting direct upload...", "info");

      const xhr = new XMLHttpRequest();
      const startTime = Date.now();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100;
          setUploadProgress(progress);

          // Calculate speed
          const currentTime = Date.now();
          const elapsedTime = (currentTime - startTime) / 1000;
          if (elapsedTime > 0) {
            const speed = e.loaded / elapsedTime;
            addLog(
              `Upload progress: ${progress.toFixed(1)}% (${formatBytes(
                speed
              )}/s)`,
              "info"
            );
          }
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status === 201) {
          const data = JSON.parse(xhr.responseText);
          setUploadStatus("completed");
          addLog(`Upload completed: ${data.data.fileName}`, "success");
          saveUploadedFile(data.data);
        } else {
          throw new Error(`Upload failed with status: ${xhr.status}`);
        }
      });

      xhr.addEventListener("error", () => {
        setUploadStatus("error");
        addLog("Upload failed - network error", "error");
      });

      xhr.open("POST", `${API_BASE_URL}/files/upload`);
      xhr.send(formData);

      abortControllerRef.current = { abort: () => xhr.abort() };
    } catch (error) {
      setUploadStatus("error");
      addLog(`Upload failed: ${error.message}`, "error");
    }
  };

  const handleUpload = () => {
    if (!selectedFile) {
      addLog("Please select a file first", "warning");
      return;
    }

    const strategy =
      uploadStrategy === "auto"
        ? selectedFile.size > (config?.chunkSize || 10 * 1024 * 1024)
          ? "chunked"
          : "direct"
        : uploadStrategy;

    addLog(
      `Starting ${strategy} upload for ${formatBytes(selectedFile.size)} file`,
      "info"
    );

    if (strategy === "chunked") {
      handleChunkedUpload();
    } else {
      handleDirectUpload();
    }
  };

  const cancelUpload = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (uploadId) {
      try {
        await fetch(
          `${API_BASE_URL}/files/chunk/cancel?upload_id=${uploadId}&total_chunks=${totalChunks}`,
          {
            method: "DELETE",
          }
        );
        addLog("Upload cancelled and cleaned up", "warning");
      } catch (error) {
        addLog(`Cleanup failed: ${error.message}`, "error");
      }
    }

    setUploadStatus("cancelled");
    setUploadProgress(0);
  };

  const retryUpload = () => {
    if (uploadStrategy === "chunked" && failedChunks.length > 0) {
      // Retry only failed chunks
      const chunkSize = config?.chunkSize || 2097152;
      handleRetryFailedChunks(uploadId, totalChunks, chunkSize);
    } else {
      // Full retry
      handleUpload();
    }
  };

  const deleteFile = async (filePath, visibility) => {
    if (!window.confirm("Are you sure you want to delete this file?")) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/files/delete?file_path=${encodeURIComponent(
          filePath
        )}&visibility=${visibility}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (data.responseCode === "00") {
        addLog(`File deleted: ${filePath}`, "success");
        const updatedFiles = uploadedFiles.filter(
          (f) => f.filePath !== filePath
        );
        setUploadedFiles(updatedFiles);
        localStorage.setItem("uploadedFiles", JSON.stringify(updatedFiles));
      } else {
        throw new Error(data.responseMessage);
      }
    } catch (error) {
      addLog(`Delete failed: ${error.message}`, "error");
    }
  };

  const getFileUrl = async (filePath, visibility) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/files/url?file_path=${encodeURIComponent(
          filePath
        )}&visibility=${visibility}`
      );
      const data = await response.json();

      if (data.responseCode === "00") {
        navigator.clipboard.writeText(data.data.url);
        addLog("File URL copied to clipboard", "success");
        // Optional: show notification
        alert("URL copied to clipboard!");
      } else {
        throw new Error(data.responseMessage);
      }
    } catch (error) {
      addLog(`URL generation failed: ${error.message}`, "error");
    }
  };

  const downloadFile = async (filePath, visibility, fileName) => {
    try {
      addLog(`Starting download: ${fileName}`, "info");
      const response = await fetch(
        `${API_BASE_URL}/files/download?file_path=${encodeURIComponent(
          filePath
        )}&visibility=${visibility}&filename=${fileName}`
      );

      if (!response.ok) throw new Error("Download failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      addLog(`File downloaded: ${fileName}`, "success");
    } catch (error) {
      addLog(`Download failed: ${error.message}`, "error");
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const getFileIcon = (type) => {
    const icons = {
      image: <Image className="w-5 h-5" />,
      video: <Video className="w-5 h-5" />,
      audio: <Music className="w-5 h-5" />,
      document: <FileText className="w-5 h-5" />,
    };
    return icons[type] || <File className="w-5 h-5" />;
  };

  const toggleVideoPlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const renderChunkProgress = () => {
    if (totalChunks === 0) return null;

    return (
      <div className="mt-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-white font-semibold">Chunk Progress</span>
          <span className="text-gray-300">
            {
              Object.values(chunkProgress).filter(
                (c) => c.status === "completed"
              ).length
            }{" "}
            / {totalChunks}
          </span>
        </div>
        <div className="grid grid-cols-10 gap-1 mb-2">
          {Array.from({ length: totalChunks }, (_, i) => {
            const chunk = chunkProgress[i];
            let bgColor = "bg-gray-600";
            let title = `Chunk ${i + 1}: Pending`;

            if (chunk) {
              if (chunk.status === "completed") bgColor = "bg-green-500";
              else if (chunk.status === "uploading") bgColor = "bg-blue-500";
              else if (chunk.status === "retrying") bgColor = "bg-yellow-500";
              else if (chunk.status === "failed") bgColor = "bg-red-500";

              title = `Chunk ${i + 1}: ${chunk.status}`;
              if (chunk.speed) title += ` (${formatBytes(chunk.speed)}/s)`;
            }

            return (
              <div
                key={i}
                className={`h-2 rounded ${bgColor} transition-all`}
                title={title}
              />
            );
          })}
        </div>
        {failedChunks.length > 0 && (
          <div className="text-yellow-400 text-sm">
            {failedChunks.length} chunks failed. Click retry to attempt again.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-2 rounded-lg">
                <Upload className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="text-sm font-bold text-white tracking-wider">
                  FileFlow
                </span>
                <p className="text-gray-400 text-sm">
                  Advanced File Management
                </p>
              </div>
            </div>

            <nav className="flex space-x-8">
              {["upload", "files", "analytics", "settings"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`capitalize px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab
                      ? "bg-purple-600 text-white"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </nav>

            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-white text-sm font-medium">Welcome, User</p>
                <p className="text-gray-400 text-xs">Administrator</p>
              </div>
              <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total Uploads</p>
                <p className="text-2xl font-bold text-white">
                  {stats.totalUploads}
                </p>
              </div>
              <BarChart3 className="w-8 h-8 text-purple-400" />
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total Size</p>
                <p className="text-2xl font-bold text-white">
                  {formatBytes(stats.totalSize)}
                </p>
              </div>
              <HardDrive className="w-8 h-8 text-blue-400" />
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Avg Speed</p>
                <p className="text-2xl font-bold text-white">
                  {formatBytes(stats.averageSpeed || 0)}/s
                </p>
              </div>
              <Zap className="w-8 h-8 text-yellow-400" />
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Active Sessions</p>
                <p className="text-2xl font-bold text-white">
                  {uploadStatus === "uploading" ? 1 : 0}
                </p>
              </div>
              <Network className="w-8 h-8 text-green-400" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {activeTab === "upload" && (
              <>
                {/* Upload Section */}
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-white">
                      Upload File
                    </h3>
                    <div className="flex items-center space-x-2 text-sm">
                      <Server className="w-4 h-4 text-purple-400" />
                      <span className="text-gray-300">
                        {config?.disk || "local"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* File Input */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-purple-400/50 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-500/10 transition-all group"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <div className="group-hover:scale-110 transition-transform">
                        <Upload className="w-12 h-12 text-purple-400 mx-auto mb-3" />
                      </div>
                      <p className="text-white font-semibold mb-1">
                        {selectedFile
                          ? selectedFile.name
                          : "Click to select file"}
                      </p>
                      <p className="text-gray-400 text-sm">
                        {selectedFile
                          ? `${formatBytes(selectedFile.size)} • ${fileType}`
                          : "Max 5GB • All types supported"}
                      </p>
                      {selectedFile && (
                        <div className="mt-3 flex justify-center space-x-4 text-xs">
                          <span className="bg-purple-500/20 text-purple-300 px-2 py-1 rounded">
                            {fileType}
                          </span>
                          <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded">
                            {formatBytes(selectedFile.size)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Preview */}
                    {selectedFile && previewUrl && (
                      <div className="bg-black/30 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-white font-semibold">Preview</h4>
                          <span className="text-gray-400 text-sm">
                            {fileType} • {formatBytes(selectedFile.size)}
                          </span>
                        </div>
                        {fileType === "image" && (
                          <img
                            src={previewUrl}
                            alt="Preview"
                            className="w-full h-64 object-contain rounded-lg"
                          />
                        )}
                        {fileType === "video" && (
                          <div className="relative">
                            <video
                              ref={videoRef}
                              src={previewUrl}
                              className="w-full h-64 object-contain rounded-lg bg-black"
                              onPlay={() => setIsPlaying(true)}
                              onPause={() => setIsPlaying(false)}
                            />
                            <button
                              onClick={toggleVideoPlay}
                              className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-purple-600 hover:bg-purple-700 rounded-full p-4 transition-all shadow-lg"
                            >
                              {isPlaying ? (
                                <Pause className="w-6 h-6 text-white" />
                              ) : (
                                <Play className="w-6 h-6 text-white" />
                              )}
                            </button>
                          </div>
                        )}
                        {fileType === "audio" && (
                          <div className="bg-black/50 rounded-lg p-4">
                            <audio
                              src={previewUrl}
                              controls
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Upload Options */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-gray-300 text-sm mb-2">
                          Upload Strategy
                        </label>
                        <select
                          value={uploadStrategy}
                          onChange={(e) => setUploadStrategy(e.target.value)}
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="auto">Auto (Recommended)</option>
                          <option value="chunked">Chunked Upload</option>
                          <option value="direct">Direct Upload</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-gray-300 text-sm mb-2">
                          File Type
                        </label>
                        <select
                          value={fileType}
                          onChange={(e) => setFileType(e.target.value)}
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="image">Image</option>
                          <option value="video">Video</option>
                          <option value="audio">Audio</option>
                          <option value="document">Document</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-gray-300 text-sm mb-2">
                          Visibility
                        </label>
                        <select
                          value={visibility}
                          onChange={(e) => setVisibility(e.target.value)}
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="public">
                            <Globe className="w-4 h-4 inline mr-2" />
                            Public
                          </option>
                          <option value="private">
                            <Lock className="w-4 h-4 inline mr-2" />
                            Private
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-gray-300 text-sm mb-2">
                          Custom Path
                        </label>
                        <input
                          type="text"
                          value={customPath}
                          onChange={(e) => setCustomPath(e.target.value)}
                          placeholder="Optional folder path"
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>

                    {/* Upload Progress */}
                    {uploadStatus !== "idle" && (
                      <div className="bg-black/30 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-2">
                            <span className="text-white font-semibold capitalize">
                              {uploadStatus === "uploading" && "Uploading..."}
                              {uploadStatus === "completed" && "Completed!"}
                              {uploadStatus === "error" && "Upload Failed"}
                              {uploadStatus === "cancelled" && "Cancelled"}
                            </span>
                            {uploadStatus === "uploading" && (
                              <Loader className="w-4 h-4 animate-spin text-purple-400" />
                            )}
                            {uploadStatus === "completed" && (
                              <Check className="w-4 h-4 text-green-400" />
                            )}
                            {uploadStatus === "error" && (
                              <AlertCircle className="w-4 h-4 text-red-400" />
                            )}
                          </div>
                          <span className="text-gray-300 font-mono">
                            {uploadProgress.toFixed(1)}%
                          </span>
                        </div>

                        <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden mb-2">
                          <div
                            className={`h-full transition-all duration-300 ${
                              uploadStatus === "completed"
                                ? "bg-green-500"
                                : uploadStatus === "error"
                                ? "bg-red-500"
                                : uploadStatus === "cancelled"
                                ? "bg-yellow-500"
                                : "bg-gradient-to-r from-purple-500 to-pink-500"
                            }`}
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>

                        {totalChunks > 0 && (
                          <div className="flex justify-between text-sm text-gray-400">
                            <span>
                              Chunk {currentChunk} of {totalChunks}
                            </span>
                            {uploadStrategy === "chunked" && (
                              <span>
                                {retryCount > 0 && `Retries: ${retryCount}`}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Chunk Progress Visualization */}
                        {uploadStrategy === "chunked" && renderChunkProgress()}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                      <button
                        onClick={handleUpload}
                        disabled={!selectedFile || uploadStatus === "uploading"}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
                      >
                        {uploadStatus === "uploading" ? (
                          <>
                            <Loader className="w-5 h-5 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="w-5 h-5" />
                            Upload File
                          </>
                        )}
                      </button>

                      {uploadStatus === "uploading" && (
                        <button
                          onClick={cancelUpload}
                          className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-xl transition-all flex items-center gap-2 shadow-lg"
                        >
                          <X className="w-5 h-5" />
                          Cancel
                        </button>
                      )}

                      {(uploadStatus === "error" ||
                        uploadStatus === "cancelled") && (
                        <button
                          onClick={retryUpload}
                          className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-3 px-6 rounded-xl transition-all flex items-center gap-2 shadow-lg"
                        >
                          <RefreshCw className="w-5 h-5" />
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Configuration Panel */}
                {config && (
                  <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20">
                    <div className="flex items-center gap-3 mb-4">
                      <Settings className="w-5 h-5 text-purple-400" />
                      <h3 className="text-xl font-bold text-white">
                        Storage Configuration
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-purple-500/20 rounded-xl p-4">
                        <HardDrive className="w-6 h-6 text-purple-400 mb-2" />
                        <p className="text-gray-400 text-xs mb-1">Chunk Size</p>
                        <p className="text-white font-semibold">
                          {config.chunkSizeHuman}
                        </p>
                      </div>
                      <div className="bg-blue-500/20 rounded-xl p-4">
                        <Shield className="w-6 h-6 text-blue-400 mb-2" />
                        <p className="text-gray-400 text-xs mb-1">Max Image</p>
                        <p className="text-white font-semibold">
                          {config.maxFileSizes?.image}
                        </p>
                      </div>
                      <div className="bg-green-500/20 rounded-xl p-4">
                        <Video className="w-6 h-6 text-green-400 mb-2" />
                        <p className="text-gray-400 text-xs mb-1">Max Video</p>
                        <p className="text-white font-semibold">
                          {config.maxFileSizes?.video}
                        </p>
                      </div>
                      <div className="bg-yellow-500/20 rounded-xl p-4">
                        <Server className="w-6 h-6 text-yellow-400 mb-2" />
                        <p className="text-gray-400 text-xs mb-1">
                          Storage Disk
                        </p>
                        <p className="text-white font-semibold uppercase">
                          {config.disk}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === "files" && (
              <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-white">
                    Uploaded Files
                  </h3>
                  <div className="flex items-center space-x-3">
                    <span className="text-gray-400 text-sm">
                      {uploadedFiles.length} files
                    </span>
                    <button
                      onClick={loadUploadedFiles}
                      className="text-purple-400 hover:text-purple-300 transition-colors p-2 hover:bg-white/5 rounded-lg"
                      title="Refresh"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {uploadedFiles.length === 0 ? (
                    <div className="text-center py-12">
                      <File className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-400 text-lg">
                        No files uploaded yet
                      </p>
                      <p className="text-gray-500 text-sm mt-2">
                        Upload your first file to get started
                      </p>
                    </div>
                  ) : (
                    uploadedFiles.map((file, index) => (
                      <div
                        key={file.filePath + index}
                        className="bg-black/30 rounded-xl p-4 hover:bg-black/40 transition-all group"
                      >
                        <div className="flex items-start gap-4">
                          <div className="text-purple-400 mt-1">
                            {getFileIcon(file.fileType)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-semibold truncate">
                                  {file.fileName}
                                </p>
                                <div className="flex items-center space-x-3 mt-1">
                                  <span className="text-gray-400 text-sm">
                                    {file.fileSizeHuman}
                                  </span>
                                  <span className="text-gray-500">•</span>
                                  <span className="text-gray-400 text-sm capitalize">
                                    {file.fileType}
                                  </span>
                                  <span className="text-gray-500">•</span>
                                  <span
                                    className={`text-xs px-2 py-1 rounded-full ${
                                      file.visibility === "public"
                                        ? "bg-green-500/20 text-green-400"
                                        : "bg-purple-500/20 text-purple-400"
                                    }`}
                                  >
                                    {file.visibility}
                                  </span>
                                </div>
                                <p className="text-gray-500 text-xs truncate mt-1">
                                  {file.filePath}
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() =>
                                getFileUrl(file.filePath, file.visibility)
                              }
                              className="p-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-all"
                              title="Copy URL"
                            >
                              <Eye className="w-4 h-4 text-white" />
                            </button>
                            <button
                              onClick={() =>
                                downloadFile(
                                  file.filePath,
                                  file.visibility,
                                  file.fileName
                                )
                              }
                              className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-all"
                              title="Download"
                            >
                              <Download className="w-4 h-4 text-white" />
                            </button>
                            <button
                              onClick={() =>
                                deleteFile(file.filePath, file.visibility)
                              }
                              className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4 text-white" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Add other tabs content for analytics and settings */}
          </div>

          {/* Right Column - Logs */}
          <div className="lg:col-span-1">
            <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 border border-white/20 sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Activity Logs</h3>
                <div className="flex items-center space-x-2">
                  <span className="text-gray-400 text-sm">
                    {logs.length} entries
                  </span>
                  <button
                    onClick={() => setLogs([])}
                    className="text-gray-400 hover:text-white transition-colors p-1"
                    title="Clear logs"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-center py-8">
                    <Clock className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-gray-400">No activity yet</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={`rounded-lg p-3 text-sm border-l-4 ${
                        log.type === "success"
                          ? "bg-green-500/10 border-l-green-500"
                          : log.type === "error"
                          ? "bg-red-500/10 border-l-red-500"
                          : log.type === "warning"
                          ? "bg-yellow-500/10 border-l-yellow-500"
                          : "bg-blue-500/10 border-l-blue-500"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {log.type === "success" && (
                          <Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                        )}
                        {log.type === "error" && (
                          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                        )}
                        {log.type === "warning" && (
                          <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                        )}
                        {log.type === "info" && (
                          <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white break-words text-xs leading-relaxed">
                            {log.message}
                          </p>
                          <p className="text-gray-400 text-xs mt-1">
                            {log.timestamp}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
