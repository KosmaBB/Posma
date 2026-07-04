from PyQt6.QtWidgets import *
from PyQt6.QtCore import *
from PyQt6.QtGui import *
from collections import deque
import math
from PyQt6.QtCore import pyqtProperty

# --- Nowe, profesjonalne widgety ---

class ProfessionalCard(QFrame):
    def __init__(self, title="", icon="", compact=False, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.NoFrame)
        
        if compact:
            self.setStyleSheet("""
                ProfessionalCard {
                    background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                        stop:0 rgba(30, 41, 59, 0.8),
                        stop:1 rgba(51, 65, 85, 0.6));
                    border: 1px solid rgba(99, 102, 241, 0.3);
                    border-radius: 8px;
                    margin: 2px;
                }
            """)
        else:
            self.setStyleSheet("""
                ProfessionalCard {
                    background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                        stop:0 rgba(30, 41, 59, 0.9),
                        stop:1 rgba(51, 65, 85, 0.7));
                    border: 2px solid rgba(99, 102, 241, 0.4);
                    border-radius: 12px;
                    margin: 5px;
                }
                ProfessionalCard:hover {
                    border-color: rgba(139, 92, 246, 0.6);
                }
            """)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20 if not compact else 12, 20 if not compact else 12, 20 if not compact else 12, 20 if not compact else 12)
        layout.setSpacing(15 if not compact else 8)
        
        if title:
            header_layout = QHBoxLayout()
            
            if icon:
                icon_label = QLabel(icon)
                icon_label.setStyleSheet("font-size: 18px; margin-right: 8px;")
                header_layout.addWidget(icon_label)
            
            title_label = QLabel(title)
            title_label.setObjectName("card_title_label") # Dodano objectName
            title_label.setStyleSheet(f"""
                QLabel {{
                    color: #f1f5f9;
                    font-size: {'14px' if compact else '18px'};
                    font-weight: bold;
                    border: none;
                    background: transparent;
                    margin-bottom: {'5px' if compact else '10px'};
                }}
            """)
            header_layout.addWidget(title_label)
            header_layout.addStretch()
            
            layout.addLayout(header_layout)
        
        self.content_widget = QWidget()
        self.content_widget.setStyleSheet("background: transparent; border: none;")
        layout.addWidget(self.content_widget)

class ModernButton(QPushButton):
    def __init__(self, text="", primary=False, secondary=False, large=False, parent=None):
        super().__init__(text, parent)
        
        base_style = """
            QPushButton {
                border: none;
                border-radius: 8px;
                font-size: %s;
                font-weight: 600;
                padding: %s;
                margin: 3px;
                text-align: center;
            }
        """ % ("16px" if large else "14px", "16px 24px" if large else "12px 20px")
        
        if primary:
            style = base_style + """
                QPushButton {
                    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                        stop:0 #6366f1, stop:1 #8b5cf6);
                    color: white;
                    border: 2px solid transparent;
                }
                QPushButton:hover {
                    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                        stop:0 #8b5cf6, stop:1 #a855f7);
                    border-color: rgba(168, 85, 247, 0.5);
                }
                QPushButton:pressed {
                    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                        stop:0 #7c3aed, stop:1 #9333ea);
                }
                QPushButton:disabled {
                    background: #64748b;
                    color: #94a3b8;
                }
            """
        elif secondary:
            style = base_style + """
                QPushButton {
                    background: rgba(99, 102, 241, 0.1);
                    color: #a5b4fc;
                    border: 2px solid rgba(99, 102, 241, 0.4);
                }
                QPushButton:hover {
                    background: rgba(99, 102, 241, 0.2);
                    border-color: #6366f1;
                    color: #c7d2fe;
                }
                QPushButton:pressed {
                    background: rgba(99, 102, 241, 0.3);
                }
                QPushButton:disabled {
                    background: rgba(100, 116, 139, 0.1);
                    color: #64748b;
                    border-color: #475569;
                }
            """
        else:
            style = base_style + """
                QPushButton {
                    background: rgba(51, 65, 85, 0.8);
                    color: #e2e8f0;
                    border: 1px solid #475569;
                }
                QPushButton:hover {
                    background: rgba(71, 85, 105, 0.9);
                    border-color: #64748b;
                }
                QPushButton:pressed {
                    background: rgba(30, 41, 59, 0.9);
                }
            """
        
        self.setStyleSheet(style)
        
        # Add subtle animation
        self.animation = QPropertyAnimation(self, b"geometry")
        self.animation.setDuration(150)
        self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)

class SystemChart(QWidget):
    def __init__(self, color="#6366f1", parent=None):
        super().__init__(parent)
        self.color = QColor(color)
        self.data_points = deque(maxlen=60)
        self.max_value = 100.0
        
        # Initialize with zeros
        for _ in range(60):
            self.data_points.append(0)
        
        self.setMinimumHeight(140)
        self.setMaximumHeight(180)
        
        # Timer for smooth updates
        self.update_timer = QTimer()
        self.update_timer.timeout.connect(self.update)
        self.update_timer.start(100)  # 10 FPS
    
    def add_data_point(self, value):
        self.data_points.append(max(0, min(100, value)))
    
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # Background with subtle pattern
        bg_gradient = QLinearGradient(0, 0, 0, self.height())
        bg_gradient.setColorAt(0, QColor(15, 23, 42, 100))
        bg_gradient.setColorAt(1, QColor(30, 41, 59, 150))
        painter.fillRect(self.rect(), QBrush(bg_gradient))
        
        # Border
        border_pen = QPen(QColor(55, 65, 81), 1)
        painter.setPen(border_pen)
        painter.drawRect(self.rect().adjusted(0, 0, -1, -1))
        
        if len(self.data_points) < 2:
            return
        
        # Calculate points
        width = self.width() - 20  # Padding
        height = self.height() - 20  # Padding
        points = []
        
        for i, value in enumerate(self.data_points):
            x = 10 + (width / (len(self.data_points) - 1)) * i
            y = 10 + height - (height * (value / self.max_value))
            points.append(QPointF(x, y))
        
        # Draw gradient fill
        if len(points) > 1:
            path = QPainterPath()
            path.moveTo(points[0].x(), self.height() - 10)
            for point in points:
                path.lineTo(point)
            path.lineTo(points[-1].x(), self.height() - 10)
            path.closeSubpath()
            
            # Gradient fill
            fill_gradient = QLinearGradient(0, 10, 0, self.height() - 10)
            color_top = QColor(self.color)
            color_top.setAlpha(120)
            color_bottom = QColor(self.color)
            color_bottom.setAlpha(20)
            fill_gradient.setColorAt(0, color_top)
            fill_gradient.setColorAt(1, color_bottom)
            
            painter.fillPath(path, QBrush(fill_gradient))
        
        # Draw main line
        line_pen = QPen(self.color, 3)
        line_pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        line_pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
        painter.setPen(line_pen)
        
        for i in range(len(points) - 1):
            painter.drawLine(points[i], points[i + 1])
        
        # Draw grid lines
        grid_pen = QPen(QColor(255, 255, 255, 20), 1)
        grid_pen.setStyle(Qt.PenStyle.DotLine)
        painter.setPen(grid_pen)
        
        # Horizontal grid lines
        for i in range(1, 4):
            y = 10 + (height / 4) * i
            painter.drawLine(10, int(y), width + 10, int(y))
        
        # Draw current value indicator
        if points:
            last_point = points[-1]
            indicator_pen = QPen(self.color, 2)
            painter.setPen(indicator_pen)
            painter.setBrush(QBrush(self.color))
            painter.drawEllipse(last_point, 4, 4)

class ProgressWidget(ProfessionalCard):
    def __init__(self, parent=None):
        super().__init__("Postęp Operacji", "⏳", parent=parent)
        
        layout = QVBoxLayout(self.content_widget)
        layout.setSpacing(15)
        
        # Overall progress
        self.overall_label = QLabel("Gotowy do rozpoczęcia")
        self.overall_label.setStyleSheet("color: #e2e8f0; font-size: 16px; font-weight: 600;")
        layout.addWidget(self.overall_label)
        
        self.overall_progress = QProgressBar()
        self.overall_progress.setStyleSheet("""
            QProgressBar {
                border: 2px solid #374151;
                border-radius: 8px;
                background: #1f2937;
                height: 24px;
                text-align: center;
                color: white;
                font-weight: bold;
            }
            QProgressBar::chunk {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #6366f1, stop:1 #8b5cf6);
                border-radius: 6px;
            }
        """)
        layout.addWidget(self.overall_progress)
        
        # Current task
        self.current_label = QLabel("Oczekiwanie na rozpoczęcie...")
        self.current_label.setStyleSheet("color: #94a3b8; font-size: 14px; margin-top: 10px;")
        layout.addWidget(self.current_label)
        
        # Task progress
        self.task_progress = QProgressBar()
        self.task_progress.setStyleSheet("""
            QProgressBar {
                border: 1px solid #374151;
                border-radius: 6px;
                background: #1f2937;
                height: 20px;
                text-align: center;
                color: #94a3b8;
                font-size: 12px;
            }
            QProgressBar::chunk {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #f59e0b, stop:1 #d97706);
                border-radius: 4px;
            }
        """)
        self.task_progress.setRange(0, 0)  # Indeterminate
        layout.addWidget(self.task_progress)
        
        self.total_tasks = 0
        self.completed_tasks = 0
    
    def start_progress(self, total_tasks):
        self.total_tasks = total_tasks
        self.completed_tasks = 0
        self.overall_progress.setRange(0, 100)
        self.overall_progress.setValue(0)
        self.overall_label.setText("Rozpoczynanie konserwacji...")
        self.task_progress.setRange(0, 0)  # Indeterminate
    
    def update_progress(self, task_name):
        self.current_label.setText(f"Wykonywanie: {task_name}")
    
    def complete_task(self):
        self.completed_tasks += 1
        progress = int((self.completed_tasks / self.total_tasks) * 100)
        self.overall_progress.setValue(progress)
        self.overall_label.setText(f"Postęp: {progress}% ({self.completed_tasks}/{self.total_tasks})")
        
        if self.completed_tasks >= self.total_tasks:
            self.current_label.setText("✅ Wszystkie zadania zakończone pomyślnie!")
            self.task_progress.setRange(0, 100)
            self.task_progress.setValue(100)

class StatusIndicator(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.status = "ok"
        self.message = "System działa prawidłowo"
        self.setFixedHeight(60)
        
        # Initialize pulse value BEFORE creating animation
        self._pulse_value = 1.0
        
        # Animation for pulsing effect
        self.pulse_animation = QPropertyAnimation(self, b"pulse_value")
        self.pulse_animation.setDuration(2000)
        self.pulse_animation.setStartValue(0.3)
        self.pulse_animation.setEndValue(1.0)
        self.pulse_animation.setEasingCurve(QEasingCurve.Type.InOutSine)
        self.pulse_animation.setLoopCount(-1)  # Infinite loop
        self.pulse_animation.start()
        
    
    def get_pulse_value(self):
        return self._pulse_value
    
    def set_pulse_value(self, value):
        self._pulse_value = value
        self.update()
    
    pulse_value = pyqtProperty(float, get_pulse_value, set_pulse_value)
    
    def set_status(self, status, message):
        self.status = status
        self.message = message
        self.update()
    
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # Background
        bg_color = QColor(30, 41, 59, 150)
        painter.fillRect(self.rect(), bg_color)
        
        # Status colors
        colors = {
            "ok": QColor(34, 197, 94),      # Green
            "warning": QColor(245, 158, 11), # Orange
            "error": QColor(239, 68, 68)     # Red
        }
        
        status_color = colors.get(self.status, colors["ok"])
        
        # Draw status indicator circle
        circle_rect = QRect(15, 15, 30, 30)
        
        # Pulsing outer ring
        pulse_color = QColor(status_color)
        pulse_color.setAlpha(int(100 * self._pulse_value))
        painter.setPen(QPen(pulse_color, 3))
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawEllipse(circle_rect.adjusted(-5, -5, 5, 5))
        
        # Main circle
        painter.setPen(QPen(status_color, 2))
        painter.setBrush(QBrush(status_color))
        painter.drawEllipse(circle_rect)
        
        # Status text
        painter.setPen(QPen(QColor(226, 232, 240)))
        font = painter.font()
        font.setPointSize(11)
        font.setWeight(QFont.Weight.Bold)
        painter.setFont(font)
        
        text_rect = QRect(55, 10, self.width() - 65, 20)
        painter.drawText(text_rect, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, "Status Systemu")
        
        # Message text
        font.setPointSize(9)
        font.setWeight(QFont.Weight.Normal)
        painter.setFont(font)
        painter.setPen(QPen(QColor(148, 163, 184)))
        
        message_rect = QRect(55, 30, self.width() - 65, 20)
        painter.drawText(message_rect, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, self.message)

class TerminalWidget(ProfessionalCard):
    def __init__(self, title="Terminal", icon="💻", parent=None):
        super().__init__(title, icon=icon, parent=parent)
        
        layout = QVBoxLayout(self.content_widget)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(5)

        self.terminal_output = QTextEdit()
        self.terminal_output.setReadOnly(True)
        self.terminal_output.setStyleSheet("""
            QTextEdit {
                background: #0f172a;
                color: #e2e8f0;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 12px;
                border: 1px solid #374151;
                border-radius: 6px;
                padding: 5px;
            }
        """)
        layout.addWidget(self.terminal_output)
    
    def append_output(self, text, type="stdout"):
        color = "#e2e8f0" # Default white/light gray
        if type == "stderr":
            color = "#ef4444" # Red
        elif type == "error":
            color = "#ef4444" # Red
        elif type == "info":
            color = "#60a5fa" # Blue
        elif type == "success":
            color = "#22c55e" # Green
        
        self.terminal_output.append(f"<span style='color: {color};'>{text}</span>")

class AutostartItemWidget(QWidget):
    remove_requested = pyqtSignal(dict)
    toggle_requested = pyqtSignal(dict, bool) # program_data, enable/disable

    def __init__(self, program_data, parent=None):
        super().__init__(parent)
        self.program_data = program_data
        
        self.setStyleSheet("""
            AutostartItemWidget {
                background: rgba(30, 41, 59, 0.3);
                border: 1px solid #374151;
                border-radius: 8px;
                padding: 10px;
                margin-bottom: 5px;
            }
            QLabel {
                color: #e2e8f0;
                font-size: 14px;
            }
            QLabel#path_label {
                color: #94a3b8;
                font-size: 11px;
            }
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 5, 10, 5)
        layout.setSpacing(10)

        icon_label = QLabel("⚡")
        icon_label.setStyleSheet("font-size: 18px;")
        layout.addWidget(icon_label)

        info_layout = QVBoxLayout()
        self.name_label = QLabel(program_data.get("name", "Unknown"))
        self.name_label.setStyleSheet("font-weight: bold;")
        info_layout.addWidget(self.name_label)

        self.path_label = QLabel(program_data.get("path", ""))
        self.path_label.setObjectName("path_label")
        info_layout.addWidget(self.path_label)
        layout.addLayout(info_layout)
        layout.addStretch()

        self.toggle_button = ModernButton("", secondary=True, large=False)
        self.toggle_button.setFixedWidth(80)
        self.toggle_button.clicked.connect(self._on_toggle_clicked)
        layout.addWidget(self.toggle_button)

        remove_button = ModernButton("🗑️", secondary=True, large=False)
        remove_button.setFixedWidth(40)
        remove_button.clicked.connect(self._on_remove_clicked)
        layout.addWidget(remove_button)
        
        self._update_toggle_button()

    def _on_toggle_clicked(self):
        current_state = self.program_data.get("enabled", False)
        self.toggle_requested.emit(self.program_data, not current_state)

    def _on_remove_clicked(self):
        self.remove_requested.emit(self.program_data)

    def update_program_data(self, new_data):
        self.program_data = new_data
        self.name_label.setText(new_data.get("name", "Unknown"))
        self.path_label.setText(new_data.get("path", ""))
        self._update_toggle_button()

# Removed HistoricalChart, AlertSettingsWidget, AlertDisplayWidget as per request
# Keeping ProfessionalCard, ModernButton, SystemChart, ProgressWidget, StatusIndicator
