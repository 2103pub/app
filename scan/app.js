```
    let video, canvas, ctx, cornerCanvas, cornerCtx, editCanvas, editCtx;
    let stream = null;
    let scannedImages = [];
    let continuousMode = false;
    let continuousInterval = null;
    let currentEditIndex = -1;
    let cropMode = false;
    let cropStart = null;
    let cropEnd = null;
    let currentRotation = 0;
    let editHistory = [];
    let historyIndex = -1;

    document.addEventListener('DOMContentLoaded', () => {
        video = document.getElementById('video');
        canvas = document.getElementById('canvas');
        ctx = canvas.getContext('2d');
        cornerCanvas = document.getElementById('cornerCanvas');
        cornerCtx = cornerCanvas.getContext('2d');
        editCanvas = document.getElementById('editCanvas');
        editCtx = editCanvas.getContext('2d');

        setupEventListeners();
        updateScanCount();
    });

    function setupEventListeners() {
        document.getElementById('startCamera').addEventListener('click', startCamera);
        document.getElementById('capture').addEventListener('click', captureImage);
        document.getElementById('toggleContinuous').addEventListener('click', toggleContinuousMode);
        document.getElementById('batchSave').addEventListener('click', batchSaveImages);
        document.getElementById('exportPDF').addEventListener('click', exportToPDF);
        document.getElementById('clearAll').addEventListener('click', clearAllScans);

        ['brightness', 'contrast', 'sharpness', 'continuousInterval'].forEach(id => {
            const input = document.getElementById(id);
            input.addEventListener('input', (e) => {
                const valueId = id + 'Value';
                let value = e.target.value;
                if (id === 'contrast') value += '%';
                if (id === 'continuousInterval') value += '秒';
                document.getElementById(valueId).textContent = value;
            });
        });

        editCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        editCanvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        editCanvas.addEventListener('touchend', handleTouchEnd, { passive: false });
        editCanvas.addEventListener('mousedown', handleMouseDown);
        editCanvas.addEventListener('mousemove', handleMouseMove);
        editCanvas.addEventListener('mouseup', handleMouseUp);

        video.addEventListener('play', () => {
            cornerCanvas.width = video.videoWidth;
            cornerCanvas.height = video.videoHeight;
            detectEdges();
        });
    }

    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                } 
            });
            video.srcObject = stream;
            
            document.getElementById('startCamera').disabled = true;
            document.getElementById('capture').disabled = false;
            document.getElementById('toggleContinuous').disabled = false;
            
            showStatus('カメラを起動しました ✨', 'success');
        } catch (err) {
            showStatus('カメラへのアクセスに失敗しました', 'error');
            console.error('Error accessing camera:', err);
        }
    }

    function detectEdges() {
        if (!document.getElementById('autoEdge').checked || video.paused || video.ended) {
            requestAnimationFrame(detectEdges);
            return;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(video, 0, 0);

        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const corners = findDocumentCorners(imageData);

        cornerCtx.clearRect(0, 0, cornerCanvas.width, cornerCanvas.height);
        if (corners) {
            drawCorners(corners);
        }

        requestAnimationFrame(detectEdges);
    }

    function findDocumentCorners(imageData) {
        const w = imageData.width;
        const h = imageData.height;
        const margin = 0.1;
        return {
            topLeft: { x: w * margin, y: h * margin },
            topRight: { x: w * (1 - margin), y: h * margin },
            bottomRight: { x: w * (1 - margin), y: h * (1 - margin) },
            bottomLeft: { x: w * margin, y: h * (1 - margin) }
        };
    }

    function drawCorners(corners) {
        cornerCtx.strokeStyle = '#00cc66';
        cornerCtx.lineWidth = 3;
        cornerCtx.setLineDash([10, 5]);

        cornerCtx.beginPath();
        cornerCtx.moveTo(corners.topLeft.x, corners.topLeft.y);
        cornerCtx.lineTo(corners.topRight.x, corners.topRight.y);
        cornerCtx.lineTo(corners.bottomRight.x, corners.bottomRight.y);
        cornerCtx.lineTo(corners.bottomLeft.x, corners.bottomLeft.y);
        cornerCtx.closePath();
        cornerCtx.stroke();

        cornerCtx.setLineDash([]);
        cornerCtx.fillStyle = '#00cc66';
        [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft].forEach(point => {
            cornerCtx.beginPath();
            cornerCtx.arc(point.x, point.y, 8, 0, Math.PI * 2);
            cornerCtx.fill();
        });
    }

    function captureImage() {
        const flash = document.getElementById('flashOverlay');
        flash.classList.add('active');
        setTimeout(() => flash.classList.remove('active'), 150);

        if (document.getElementById('hapticFeedback').checked && navigator.vibrate) {
            navigator.vibrate([30, 10, 30]);
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        if (document.getElementById('glareReduction').checked) {
            imageData = reduceGlare(imageData);
        }

        imageData = adjustBrightnessContrast(imageData);
        
        if (document.getElementById('sharpness').value > 0) {
            imageData = applySharpen(imageData);
        }

        if (document.getElementById('grayscale').checked) {
            imageData = convertToGrayscale(imageData);
        }

        ctx.putImageData(imageData, 0, 0);

        if (document.getElementById('autoEdge').checked) {
            applyPerspectiveCorrection();
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        scannedImages.push(dataUrl);
        updateImageGrid();
        updateScanCount();
        
        document.getElementById('batchSave').disabled = false;
        document.getElementById('exportPDF').disabled = false;
        document.getElementById('clearAll').disabled = false;

        showStatus('📸 撮影しました！', 'success');
    }

    function reduceGlare(imageData) {
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            const brightness = (r + g + b) / 3;
            if (brightness > 200) {
                const factor = 200 / brightness;
                data[i] = Math.min(255, r * factor);
                data[i + 1] = Math.min(255, g * factor);
                data[i + 2] = Math.min(255, b * factor);
            }
        }
        
        return imageData;
    }

    function adjustBrightnessContrast(imageData) {
        const data = imageData.data;
        const brightness = parseInt(document.getElementById('brightness').value);
        const contrast = parseInt(document.getElementById('contrast').value) / 100;

        for (let i = 0; i < data.length; i += 4) {
            data[i] = clamp((data[i] - 128) * contrast + 128 + brightness);
            data[i + 1] = clamp((data[i + 1] - 128) * contrast + 128 + brightness);
            data[i + 2] = clamp((data[i + 2] - 128) * contrast + 128 + brightness);
        }

        return imageData;
    }

    function applySharpen(imageData) {
        const sharpness = parseInt(document.getElementById('sharpness').value) / 100;
        const data = imageData.data;
        const w = imageData.width;
        const h = imageData.height;
        const output = new Uint8ClampedArray(data);

        const kernel = [
            0, -sharpness, 0,
            -sharpness, 1 + 4 * sharpness, -sharpness,
            0, -sharpness, 0
        ];

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                for (let c = 0; c < 3; c++) {
                    let sum = 0;
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const idx = ((y + ky) * w + (x + kx)) * 4 + c;
                            sum += data[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
                        }
                    }
                    output[(y * w + x) * 4 + c] = clamp(sum);
                }
            }
        }

        return new ImageData(output, w, h);
    }

    function convertToGrayscale(imageData) {
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            data[i] = data[i + 1] = data[i + 2] = gray;
        }
        
        return imageData;
    }

    function applyPerspectiveCorrection() {
        const correctedCanvas = document.createElement('canvas');
        const w = canvas.width;
        const h = canvas.height;
        
        correctedCanvas.width = w * 0.8;
        correctedCanvas.height = h * 0.8;
        
        const correctedCtx = correctedCanvas.getContext('2d');
        correctedCtx.drawImage(
            canvas,
            w * 0.1, h * 0.1, w * 0.8, h * 0.8,
            0, 0, correctedCanvas.width, correctedCanvas.height
        );
        
        canvas.width = correctedCanvas.width;
        canvas.height = correctedCanvas.height;
        ctx.drawImage(correctedCanvas, 0, 0);
    }

    function toggleContinuousMode() {
        continuousMode = !continuousMode;
        const indicator = document.getElementById('continuousIndicator');
        const btn = document.getElementById('toggleContinuous');

        if (continuousMode) {
            indicator.style.display = 'inline-flex';
            btn.textContent = '⏸ 停止';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-danger');
            startContinuousCapture();
        } else {
            indicator.style.display = 'none';
            btn.textContent = '🔄 連続撮影';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-secondary');
            stopContinuousCapture();
        }
    }

    function startContinuousCapture() {
        const interval = parseFloat(document.getElementById('continuousInterval').value) * 1000;
        continuousInterval = setInterval(() => {
            captureImage();
        }, interval);
    }

    function stopContinuousCapture() {
        if (continuousInterval) {
            clearInterval(continuousInterval);
            continuousInterval = null;
        }
    }

    function updateImageGrid() {
        const grid = document.getElementById('imageGrid');
        grid.innerHTML = '';

        scannedImages.forEach((dataUrl, index) => {
            const item = document.createElement('div');
            item.className = 'scanned-item';
            item.onclick = () => showPreview(dataUrl);

            const img = document.createElement('img');
            img.src = dataUrl;

            const actions = document.createElement('div');
            actions.className = 'item-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'action-btn';
            editBtn.innerHTML = '✏️';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                openEditModal(index);
            };

            const removeBtn = document.createElement('button');
            removeBtn.className = 'action-btn';
            removeBtn.innerHTML = '×';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeImage(index);
            };

            actions.appendChild(editBtn);
            actions.appendChild(removeBtn);

            item.appendChild(img);
            item.appendChild(actions);
            grid.appendChild(item);
        });
    }

    function removeImage(index) {
        scannedImages.splice(index, 1);
        updateImageGrid();
        updateScanCount();

        if (scannedImages.length === 0) {
            document.getElementById('batchSave').disabled = true;
            document.getElementById('exportPDF').disabled = true;
            document.getElementById('clearAll').disabled = true;
        }
    }

    function clearAllScans() {
        if (confirm('すべてのスキャンを削除しますか？')) {
            scannedImages = [];
            updateImageGrid();
            updateScanCount();
            document.getElementById('batchSave').disabled = true;
            document.getElementById('exportPDF').disabled = true;
            document.getElementById('clearAll').disabled = true;
            showStatus('🗑️ すべて削除しました', 'success');
        }
    }

    function updateScanCount() {
        document.getElementById('scanCount').textContent = scannedImages.length;
    }

    function openEditModal(index) {
        currentEditIndex = index;
        currentRotation = 0;
        editHistory = [];
        historyIndex = -1;
        
        const img = new Image();
        img.onload = () => {
            editCanvas.width = img.width;
            editCanvas.height = img.height;
            editCtx.drawImage(img, 0, 0);
            saveToHistory();
            document.getElementById('editModal').classList.add('active');
        };
        img.src = scannedImages[index];
    }

    function closeEditModal() {
        document.getElementById('editModal').classList.remove('active');
        cropMode = false;
        document.getElementById('cropBtn').classList.remove('active');
    }

    function saveToHistory() {
        const imageData = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
        editHistory = editHistory.slice(0, historyIndex + 1);
        editHistory.push({
            data: imageData,
            width: editCanvas.width,
            height: editCanvas.height
        });
        historyIndex++;
        if (editHistory.length > 20) {
            editHistory.shift();
            historyIndex--;
        }
        updateUndoRedoButtons();
    }

    function undoEdit() {
        if (historyIndex > 0) {
            historyIndex--;
            const state = editHistory[historyIndex];
            editCanvas.width = state.width;
            editCanvas.height = state.height;
            editCtx.putImageData(state.data, 0, 0);
            updateUndoRedoButtons();
        }
    }

    function redoEdit() {
        if (historyIndex < editHistory.length - 1) {
            historyIndex++;
            const state = editHistory[historyIndex];
            editCanvas.width = state.width;
            editCanvas.height = state.height;
            editCtx.putImageData(state.data, 0, 0);
            updateUndoRedoButtons();
        }
    }

    function updateUndoRedoButtons() {
        document.getElementById('undoBtn').disabled = historyIndex <= 0;
        document.getElementById('redoBtn').disabled = historyIndex >= editHistory.length - 1;
    }

    let touchStartPos = null;

    function handleTouchStart(e) {
        e.preventDefault();
        if (!cropMode) return;
        const touch = e.touches[0];
        const rect = editCanvas.getBoundingClientRect();
        cropStart = {
            x: (touch.clientX - rect.left) * (editCanvas.width / rect.width),
            y: (touch.clientY - rect.top) * (editCanvas.height / rect.height)
        };
        touchStartPos = cropStart;
    }

    function handleTouchMove(e) {
        e.preventDefault();
        if (!cropMode || !cropStart) return;
        const touch = e.touches[0];
        const rect = editCanvas.getBoundingClientRect();
        cropEnd = {
            x: (touch.clientX - rect.left) * (editCanvas.width / rect.width),
            y: (touch.clientY - rect.top) * (editCanvas.height / rect.height)
        };
        drawCropOverlay();
    }

    function handleTouchEnd(e) {
        e.preventDefault();
        if (!cropMode || !cropStart || !cropEnd) return;
        applyCrop();
        cropStart = null;
        cropEnd = null;
        cropMode = false;
        document.getElementById('cropBtn').classList.remove('active');
        touchStartPos = null;
    }

    function handleMouseDown(e) {
        if (!cropMode) return;
        const rect = editCanvas.getBoundingClientRect();
        cropStart = {
            x: (e.clientX - rect.left) * (editCanvas.width / rect.width),
            y: (e.clientY - rect.top) * (editCanvas.height / rect.height)
        };
    }

    function handleMouseMove(e) {
        if (!cropMode || !cropStart) return;
        const rect = editCanvas.getBoundingClientRect();
        cropEnd = {
            x: (e.clientX - rect.left) * (editCanvas.width / rect.width),
            y: (e.clientY - rect.top) * (editCanvas.height / rect.height)
        };
        drawCropOverlay();
    }

    function handleMouseUp(e) {
        if (!cropMode || !cropStart || !cropEnd) return;
        applyCrop();
        cropStart = null;
        cropEnd = null;
        cropMode = false;
        document.getElementById('cropBtn').classList.remove('active');
    }

    function enableCropMode() {
        cropMode = !cropMode;
        const btn = document.getElementById('cropBtn');
        if (cropMode) {
            btn.classList.add('active');
            editCanvas.style.cursor = 'crosshair';
        } else {
            btn.classList.remove('active');
            editCanvas.style.cursor = 'default';
            cropStart = null;
            cropEnd = null;
        }
    }

    function drawCropOverlay() {
        const state = editHistory[historyIndex];
        editCtx.putImageData(state.data, 0, 0);
        
        if (cropStart && cropEnd) {
            const x = Math.min(cropStart.x, cropEnd.x);
            const y = Math.min(cropStart.y, cropEnd.y);
            const w = Math.abs(cropEnd.x - cropStart.x);
            const h = Math.abs(cropEnd.y - cropStart.y);

            editCtx.strokeStyle = '#0066ff';
            editCtx.lineWidth = 3;
            editCtx.setLineDash([8, 8]);
            editCtx.strokeRect(x, y, w, h);
            editCtx.setLineDash([]);
        }
    }

    function applyCrop() {
        const x = Math.min(cropStart.x, cropEnd.x);
        const y = Math.min(cropStart.y, cropEnd.y);
        const w = Math.abs(cropEnd.x - cropStart.x);
        const h = Math.abs(cropEnd.y - cropStart.y);

        if (w < 10 || h < 10) return;

        const croppedData = editCtx.getImageData(x, y, w, h);
        editCanvas.width = w;
        editCanvas.height = h;
        editCtx.putImageData(croppedData, 0, 0);
        saveToHistory();
    }

    function rotateImage(degrees) {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        if (Math.abs(degrees) === 90) {
            tempCanvas.width = editCanvas.height;
            tempCanvas.height = editCanvas.width;
        } else {
            tempCanvas.width = editCanvas.width;
            tempCanvas.height = editCanvas.height;
        }

        tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
        tempCtx.rotate((degrees * Math.PI) / 180);
        tempCtx.drawImage(editCanvas, -editCanvas.width / 2, -editCanvas.height / 2);

        editCanvas.width = tempCanvas.width;
        editCanvas.height = tempCanvas.height;
        editCtx.drawImage(tempCanvas, 0, 0);
        saveToHistory();
    }

    function applyFilter(filterType) {
        const imageData = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
        const data = imageData.data;

        switch(filterType) {
            case 'grayscale':
                for (let i = 0; i < data.length; i += 4) {
                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }
                break;
            case 'blackwhite':
                for (let i = 0; i < data.length; i += 4) {
                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    const bw = gray > 128 ? 255 : 0;
                    data[i] = data[i + 1] = data[i + 2] = bw;
                }
                break;
            case 'sepia':
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
                    data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
                    data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
                }
                break;
            case 'invert':
                for (let i = 0; i < data.length; i += 4) {
                    data[i] = 255 - data[i];
                    data[i + 1] = 255 - data[i + 1];
                    data[i + 2] = 255 - data[i + 2];
                }
                break;
        }

        editCtx.putImageData(imageData, 0, 0);
        saveToHistory();
    }

    function resetEdit() {
        const img = new Image();
        img.onload = () => {
            editCanvas.width = img.width;
            editCanvas.height = img.height;
            editCtx.drawImage(img, 0, 0);
            editHistory = [];
            historyIndex = -1;
            saveToHistory();
        };
        img.src = scannedImages[currentEditIndex];
    }

    function saveEdit() {
        scannedImages[currentEditIndex] = editCanvas.toDataURL('image/jpeg', 0.95);
        updateImageGrid();
        closeEditModal();
        showStatus('✅ 編集を保存しました', 'success');
        
        if (navigator.vibrate) {
            navigator.vibrate([40, 20, 40]);
        }
    }

    async function batchSaveImages() {
        const zip = new JSZip();
        const timestamp = new Date().toISOString().split('T')[0];

        scannedImages.forEach((dataUrl, index) => {
            const base64Data = dataUrl.split(',')[1];
            zip.file(`scan_${String(index + 1).padStart(3, '0')}.jpg`, base64Data, { base64: true });
        });

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scans_${timestamp}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('💾 一括保存しました！', 'success');
    }

    function showPreview(dataUrl) {
        document.getElementById('previewImage').src = dataUrl;
        document.getElementById('previewModal').classList.add('active');
    }

    function closePreview() {
        document.getElementById('previewModal').classList.remove('active');
    }

    async function exportToPDF() {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        for (let i = 0; i < scannedImages.length; i++) {
            if (i > 0) {
                pdf.addPage();
            }

            const img = new Image();
            img.src = scannedImages[i];
            
            await new Promise(resolve => {
                img.onload = () => {
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    const imgRatio = img.width / img.height;
                    const pageRatio = pageWidth / pageHeight;

                    let finalWidth, finalHeight;
                    if (imgRatio > pageRatio) {
                        finalWidth = pageWidth - 20;
                        finalHeight = finalWidth / imgRatio;
                    } else {
                        finalHeight = pageHeight - 20;
                        finalWidth = finalHeight * imgRatio;
                    }

                    const x = (pageWidth - finalWidth) / 2;
                    const y = (pageHeight - finalHeight) / 2;

                    pdf.addImage(scannedImages[i], 'JPEG', x, y, finalWidth, finalHeight);
                    resolve();
                };
            });
        }

        const timestamp = new Date().toISOString().split('T')[0];
        pdf.save(`scan_${timestamp}.pdf`);
        showStatus('📄 PDFを出力しました', 'success');
    }

    function showStatus(message, type) {
        const statusDiv = document.getElementById('statusMessage');
        statusDiv.className = `status-message status-${type}`;
        statusDiv.textContent = message;
        statusDiv.style.display = 'block';

        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }

    function clamp(value) {
        return Math.max(0, Math.min(255, value));
    }

    document.getElementById('previewModal').addEventListener('click', (e) => {
        if (e.target.id === 'previewModal') {
            closePreview();
        }
    });

    document.getElementById('editModal').addEventListener('click', (e) => {
        if (e.target.id === 'editModal') {
            closeEditModal();
        }
    });
```
