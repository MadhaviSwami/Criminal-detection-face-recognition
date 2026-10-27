"""
Face Detection Service
Uses OpenCV's YuNet DNN face detector for reliable face detection.
No C++ build tools required — works purely with pre-trained ONNX models.
"""

import cv2
import numpy as np
import os
import logging

logger = logging.getLogger(__name__)

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YUNET_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'face_detection_yunet_2023mar.onnx')

# Global detector instance
_detector = None


def _get_detector(input_size=(320, 320)):
    """Create a YuNet face detector instance."""
    global _detector
    if _detector is None:
        if not os.path.exists(YUNET_MODEL_PATH):
            raise FileNotFoundError(
                f"YuNet model not found at {YUNET_MODEL_PATH}. "
                "Please download it from OpenCV's model zoo."
            )
        _detector = cv2.FaceDetectorYN.create(
            model=YUNET_MODEL_PATH,
            config='',
            input_size=input_size,
            score_threshold=0.6,
            nms_threshold=0.3,
            top_k=50
        )
        logger.info("YuNet face detector loaded successfully.")
    return _detector


def detect_faces_in_image(img):
    """
    Detect faces in an already-loaded BGR image.
    Returns the YuNet faces array (N, 15), or None if no faces found.
    """
    h, w = img.shape[:2]
    detector = _get_detector()
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    return faces


def detect_faces(image_path):
    """
    Detect all faces in an image using YuNet.

    Args:
        image_path: Path to the image file.

    Returns:
        tuple: (image, faces_array)
            - image: the loaded BGR image (numpy array)
            - faces_array: numpy array of shape (N, 15) where each row contains:
                [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
                (bounding box, right eye, left eye, nose tip, right/left corner of mouth, confidence)
              Returns None if no faces found.
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")

    faces = detect_faces_in_image(img)

    if faces is not None:
        logger.info(f"Detected {len(faces)} face(s) in {os.path.basename(image_path)}")
    else:
        logger.info(f"No faces detected in {os.path.basename(image_path)}")

    return img, faces


def draw_detections(image, faces):
    """
    Draw bounding boxes and landmarks on detected faces.

    Args:
        image: BGR image (numpy array).
        faces: Faces array from detect_faces().

    Returns:
        Annotated image (numpy array).
    """
    output = image.copy()

    if faces is None:
        return output

    for i, face in enumerate(faces):
        # Bounding box
        x, y, w, h = int(face[0]), int(face[1]), int(face[2]), int(face[3])
        confidence = face[14]

        # Draw box
        cv2.rectangle(output, (x, y), (x + w, y + h), (0, 255, 128), 2)

        # Draw label
        label = f"Face {i + 1} ({confidence:.0%})"
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.55
        thickness = 2
        (tw, th), baseline = cv2.getTextSize(label, font, font_scale, thickness)
        cv2.rectangle(output, (x, y - th - 10), (x + tw + 6, y), (0, 255, 128), -1)
        cv2.putText(output, label, (x + 3, y - 5), font, font_scale, (0, 0, 0), thickness)

        # Draw landmarks (eyes, nose, mouth corners)
        landmarks = face[4:14].reshape(5, 2).astype(int)
        colors = [(255, 0, 0), (0, 0, 255), (0, 255, 0), (255, 0, 255), (0, 255, 255)]
        for j, (lx, ly) in enumerate(landmarks):
            cv2.circle(output, (lx, ly), 3, colors[j], -1)

    return output


def crop_face(image, face, padding=25):
    """
    Crop a single face from the image with padding.

    Args:
        image: BGR image (numpy array).
        face: Single face row from faces array.
        padding: Extra pixels around the face.

    Returns:
        Cropped face image (numpy array).
    """
    h, w = image.shape[:2]
    x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])

    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(w, x + fw + padding)
    y2 = min(h, y + fh + padding)

    return image[y1:y2, x1:x2]


def get_face_count(image_path):
    """Quick utility: return just the number of faces in an image."""
    _, faces = detect_faces(image_path)
    return 0 if faces is None else len(faces)
