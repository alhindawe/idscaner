let frontImageData = null;
let backImageData = null;
let videoStream = null;
let maxContour = null; // تعريف المتغير كمتغير عام

const videoElement = document.getElementById('videoElement');
const canvas = document.getElementById('canvas'); // لاستخدامه لالتقاط الصور
const overlay = document.getElementById('overlay'); // لرسم المربع حول البطاقة
const captureFrontBtn = document.getElementById('captureFront');
const captureBackBtn = document.getElementById('captureBack');
const saveImageBtn = document.getElementById('saveImage');
const imageNameInput = document.getElementById('imageName');
const imageNameContainer = document.getElementById('imageNameContainer');
const saveContainer = document.getElementById('saveContainer');
const videoContainer = document.getElementById('videoContainer');

let isProcessing = false;
let src = null;
let gray = null;
let cap = null;

function startCamera() {
    const constraints = {
        video: {
            facingMode: "environment" // طلب الكاميرا الخلفية
        }
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
            videoStream = stream;
            videoElement.srcObject = stream;
            videoContainer.style.display = 'block';

            videoElement.onloadedmetadata = function() {
                // إعداد OpenCV بعد تحميل الفيديو
                initOpenCV();
            };
        })
        .catch((err) => {
            alert('فشل الوصول إلى الكاميرا: ' + err);
        });
}

function stopCamera() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    videoContainer.style.display = 'none';

    // تحرير موارد OpenCV
    if (src) { src.delete(); src = null; }
    if (gray) { gray.delete(); gray = null; }
    if (cap) { cap = null; }
}

function initOpenCV() {
    // إنشاء كائنات OpenCV عند الحاجة فقط
    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;

    overlay.width = width;
    overlay.height = height;

    src = new cv.Mat(height, width, cv.CV_8UC4);
    gray = new cv.Mat();
    cap = new cv.VideoCapture(videoElement);

    processVideo();
}

function processVideo() {
    if (!videoStream) {
        return;
    }

    try {
        if (!isProcessing) {
            isProcessing = true;

            cap.read(src);
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // تطبيق التمويه لتقليل الضوضاء
            cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

            // اكتشاف الحواف
            cv.Canny(gray, gray, 50, 150);

            // العثور على الحواف (contours)
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(gray, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // رسم المستطيلات المحيطة بالبطاقة
            let maxArea = 0;
            let tempMaxContour = null;

            for (let i = 0; i < contours.size(); i++) {
                let contour = contours.get(i);
                let area = cv.contourArea(contour);

                if (area > 10000) { // يمكنك تعديل هذه القيمة حسب حجم البطاقة المتوقع
                    let peri = cv.arcLength(contour, true);
                    let approx = new cv.Mat();
                    cv.approxPolyDP(contour, approx, 0.02 * peri, true);

                    if (approx.rows === 4 && area > maxArea) {
                        if (tempMaxContour) {
                            tempMaxContour.delete();
                        }
                        maxArea = area;
                        tempMaxContour = approx;
                    } else {
                        approx.delete();
                    }
                }
                contour.delete();
            }

            // تحديث maxContour العام
            if (maxContour) {
                maxContour.delete();
                maxContour = null;
            }

            if (tempMaxContour) {
                maxContour = tempMaxContour;
            }

            // رسم المستطيل على الـ overlay
            let context = overlay.getContext('2d');
            context.clearRect(0, 0, overlay.width, overlay.height);

            if (maxContour) {
                context.lineWidth = 4;
                context.strokeStyle = 'red';
                context.beginPath();
                let points = [];
                for (let i = 0; i < 4; i++) {
                    let point = {
                        x: maxContour.data32S[i * 2],
                        y: maxContour.data32S[i * 2 + 1]
                    };
                    points.push(point);
                }
                context.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    context.lineTo(points[i].x, points[i].y);
                }
                context.closePath();
                context.stroke();
            }

            hierarchy.delete();
            contours.delete();

            isProcessing = false;
        }

        // طلب الإطار التالي
        requestAnimationFrame(processVideo);

    } catch (err) {
        console.log('خطأ في معالجة الفيديو:', err);
        isProcessing = false;
        // محاولة إعادة تشغيل المعالجة
        requestAnimationFrame(processVideo);
    }
}

function captureImage() {
    // ستقوم هذه الوظيفة بالتقاط الصورة داخل المستطيل المحدد إذا تم اكتشافه

    if (!maxContour) {
        alert('لم يتم اكتشاف بطاقة الهوية. يرجى التأكد من وضع البطاقة بشكل واضح أمام الكاميرا.');
        return null;
    }

    // استخراج الصورة داخل المستطيل
    const srcQuad = [];
    for (let i = 0; i < 4; i++) {
        srcQuad.push({
            x: maxContour.data32S[i * 2],
            y: maxContour.data32S[i * 2 + 1]
        });
    }

    // ترتيب النقاط في اتجاه معين (ساعي الساعة) لضمان التحويل الصحيح
    srcQuad.sort((a, b) => a.y - b.y); // ترتيب حسب المحور y
    let topPoints = srcQuad.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottomPoints = srcQuad.slice(2).sort((a, b) => a.x - b.x);

    const orderedSrcQuad = [
        topPoints[0], // أعلى اليسار
        topPoints[1], // أعلى اليمين
        bottomPoints[1], // أسفل اليمين
        bottomPoints[0]  // أسفل اليسار
    ];

    // تحديد أبعاد البطاقة القياسية (يمكنك تعديلها حسب الأبعاد الفعلية)
    const cardWidth = 640;
    const cardHeight = 400;

    const dstQuad = [
        { x: 0, y: 0 },
        { x: cardWidth - 1, y: 0 },
        { x: cardWidth - 1, y: cardHeight -1 },
        { x: 0, y: cardHeight -1 }
    ];

    // إنشاء مصفوفات للتحويل
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [].concat(...orderedSrcQuad.map(p => [p.x, p.y])));
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [].concat(...dstQuad.map(p => [p.x, p.y])));

    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let dst = new cv.Mat();

    cv.warpPerspective(src, dst, M, new cv.Size(cardWidth, cardHeight));

    // تحويل الصورة إلى بيانات Base64
    cv.cvtColor(dst, dst, cv.COLOR_RGBA2BGRA);
    cv.imshow('canvas', dst);

    // تحرير الموارد
    srcTri.delete();
    dstTri.delete();
    M.delete();
    dst.delete();

    return canvas.toDataURL('image/png');
}

captureFrontBtn.addEventListener('click', () => {
    startCamera();
    captureFrontBtn.style.display = 'none';
    captureBackBtn.style.display = 'none';

    alert('قم بتوجيه الكاميرا نحو وجه البطاقة. سيتم تحديدها تلقائيًا.');

    videoElement.addEventListener('click', function captureFrontImage() {
        frontImageData = captureImage();
        if (frontImageData) {
            stopCamera();
            videoElement.removeEventListener('click', captureFrontImage);

            captureFrontBtn.textContent = 'إعادة التقاط وجه البطاقة';
            captureFrontBtn.style.display = 'inline-block';
            captureBackBtn.disabled = false;
            captureBackBtn.style.display = 'inline-block';
        }
    });
});

captureBackBtn.addEventListener('click', () => {
    startCamera();
    captureFrontBtn.style.display = 'none';
    captureBackBtn.style.display = 'none';

    alert('قم بتوجيه الكاميرا نحو ظهر البطاقة. سيتم تحديدها تلقائيًا.');

    videoElement.addEventListener('click', function captureBackImage() {
        backImageData = captureImage();
        if (backImageData) {
            stopCamera();
            videoElement.removeEventListener('click', captureBackImage);

            captureBackBtn.textContent = 'إعادة التقاط ظهر البطاقة';
            captureBackBtn.style.display = 'inline-block';

            // تحقق من وجود الصورتين
            if (frontImageData && backImageData) {
                imageNameContainer.style.display = 'block';
                saveContainer.style.display = 'block';
                saveImageBtn.disabled = false;
            }
        }
    });
});

saveImageBtn.addEventListener('click', async () => {
    const mergedImageData = await mergeImages();
    const imageName = imageNameInput.value.trim() || 'صورة البطاقة';

    // إنشاء رابط التنزيل
    const link = document.createElement('a');
    link.href = mergedImageData;
    link.download = `${imageName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    alert('تم حفظ الصورة بنجاح.');

    // إعادة تعيين التطبيق
    resetApp();
});

function mergeImages() {
    return new Promise((resolve) => {
        const imgFront = new Image();
        const imgBack = new Image();
        imgFront.src = frontImageData;
        imgBack.src = backImageData;

        imgFront.onload = function() {
            imgBack.onload = function() {
                const mergedCanvas = document.createElement('canvas');
                const maxWidth = Math.max(imgFront.width, imgBack.width);
                const totalHeight = imgFront.height + imgBack.height;

                mergedCanvas.width = maxWidth;
                mergedCanvas.height = totalHeight;

                const ctx = mergedCanvas.getContext('2d');
                ctx.drawImage(imgFront, 0, 0);
                ctx.drawImage(imgBack, 0, imgFront.height);

                resolve(mergedCanvas.toDataURL('image/png'));
            }
        }
    });
}

function resetApp() {
    frontImageData = null;
    backImageData = null;
    captureFrontBtn.textContent = 'التقاط وجه البطاقة';
    captureBackBtn.textContent = 'التقاط ظهر البطاقة';
    captureBackBtn.disabled = true;

    imageNameInput.value = '';
    imageNameContainer.style.display = 'none';
    saveContainer.style.display = 'none';
    saveImageBtn.disabled = true;
}

window.addEventListener('beforeunload', () => {
    stopCamera();
});