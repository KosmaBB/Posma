from PyQt6.QtWidgets import *
from PyQt6.QtCore import *
from PyQt6.QtGui import *
from collections import deque

class ProfessionalCard(QFrame):
    def __init__(self, title="", icon="", compact=False, parent=None):
        super().__init__(parent)
        self.setFrameStyle(QFrame.Shape.NoFrame)
        base_style = "border: 1px solid rgba(99, 102, 241, 0.3); border-radius: %spx; margin: %spx;"
        bg_style = "background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 rgba(30, 41, 59, 0.8), stop:1 rgba(51, 65, 85, 0.6));"
        
        if compact:
            self.setStyleSheet(f"ProfessionalCard {{ {bg_style} {base_style % ('8', '2')} }}")
        else:
            self.setStyleSheet(f"ProfessionalCard {{ {bg_style.replace('0.8', '0.9').replace('0.6', '0.7')} {base_style % ('12', '5')} border-width: 2px; }} ProfessionalCard:hover {{ border-color: rgba(139, 92, 246, 0.6); }}")

        layout = QVBoxLayout(self)
        margins = 12 if compact else 20
        layout.setContentsMargins(margins, margins, margins, margins)
        layout.setSpacing(8 if compact else 15)
        
        if title or icon:
            header_layout = QHBoxLayout()
            if icon:
                icon_label = QLabel(icon)
                icon_label.setStyleSheet("font-size: 18px; margin-right: 8px; background: transparent; border: none;")
                header_layout.addWidget(icon_label)
            
            self.title_label = QLabel(title)
            self.title_label.setObjectName("card_title_label")
            self.title_label.setStyleSheet(f"color: #f1f5f9; font-size: {'14px' if compact else '18px'}; font-weight: bold; border: none; background: transparent; margin-bottom: {'5px' if compact else '10px'};")
            header_layout.addWidget(self.title_label)
            header_layout.addStretch()
            layout.addLayout(header_layout)
        
        self.content_widget = QWidget()
        self.content_widget.setStyleSheet("background: transparent; border: none;")
        layout.addWidget(self.content_widget)

    def set_title(self, text):
        if hasattr(self, 'title_label'):
            self.title_label.setText(text)

class ModernButton(QPushButton):
    def __init__(self, text="", primary=False, secondary=False, large=False, parent=None):
        super().__init__(text, parent)
        font_size = "16px" if large else "14px"
        padding = "16px 24px" if large else "12px 20px"
        base_style = f"border: none; border-radius: 8px; font-size: {font_size}; font-weight: 600; padding: {padding}; margin: 3px; text-align: center;"
        
        style = ""
        if primary: style = "background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #6366f1, stop:1 #8b5cf6); color: white;"
        elif secondary: style = "background: rgba(99, 102, 241, 0.1); color: #a5b4fc; border: 2px solid rgba(99, 102, 241, 0.4);"
        else: style = "background: rgba(51, 65, 85, 0.8); color: #e2e8f0; border: 1px solid #475569;"
        
        self.setStyleSheet(f"QPushButton {{ {base_style} {style} }} /* Add :hover, :pressed, :disabled styles as needed */")

class SystemChart(QWidget):
    def __init__(self, color="#6366f1", parent=None):
        super().__init__(parent)
        self.color = QColor(color)
        self.data_points = deque([0.0] * 60, maxlen=60)
        self.setMinimumHeight(140)
        self.setMaximumHeight(180)
        self.update_timer = QTimer(self)
        self.update_timer.timeout.connect(self.update)
        self.update_timer.start(50) # Smooth 20 FPS
    
    def add_data_point(self, value): self.data_points.append(max(0, min(100, value)))
    
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        bg_gradient = QLinearGradient(0, 0, 0, self.height())
        bg_gradient.setColorAt(0, QColor(15, 23, 42, 100))
        bg_gradient.setColorAt(1, QColor(30, 41, 59, 150))
        painter.fillRect(self.rect(), bg_gradient)
        
        width, height = self.width() - 20, self.height() - 20
        points = [QPointF(10 + i * width / 59, 10 + height - (height * v / 100)) for i, v in enumerate(self.data_points)]
        
        path = QPainterPath(points[0])
        for p in points[1:]: path.lineTo(p)
        
        fill_gradient = QLinearGradient(0, 10, 0, self.height() - 10)
        c_top, c_bottom = QColor(self.color), QColor(self.color)
        c_top.setAlpha(120); c_bottom.setAlpha(10)
        fill_gradient.setColorAt(0, c_top); fill_gradient.setColorAt(1, c_bottom)
        
        fill_path = QPainterPath(path)
        fill_path.lineTo(points[-1].x(), self.height() - 10)
        fill_path.lineTo(points[0].x(), self.height() - 10)
        painter.fillPath(fill_path, QBrush(fill_gradient))

        pen = QPen(self.color, 3, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
        painter.setPen(pen)
        painter.drawPath(path)

class ProgressWidget(ProfessionalCard):
    def __init__(self, parent=None):
        super().__init__("Postęp Operacji", "⏳", parent=parent)
        layout = QVBoxLayout(self.content_widget)
        layout.setSpacing(15)
        
        self.overall_label = QLabel("Gotowy do rozpoczęcia")
        self.overall_label.setStyleSheet("color: #e2e8f0; font-size: 16px; font-weight: 600;")
        layout.addWidget(self.overall_label)
        
        self.overall_progress = QProgressBar()
        self.overall_progress.setStyleSheet("QProgressBar { border: 2px solid #374151; border-radius: 8px; background: #1f2937; height: 24px; text-align: center; color: white; font-weight: bold; } QProgressBar::chunk { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #6366f1, stop:1 #8b5cf6); border-radius: 6px; }")
        layout.addWidget(self.overall_progress)
        
        self.current_label = QLabel("Oczekiwanie na rozpoczęcie...")
        self.current_label.setStyleSheet("color: #94a3b8; font-size: 14px; margin-top: 10px;")
        layout.addWidget(self.current_label)
        
    def start_progress(self, total): self.total, self.completed = total, 0; self.overall_progress.setValue(0); self.overall_label.setText("Rozpoczynanie...")
    def update_progress(self, name): self.current_label.setText(f"Wykonywanie: {name}")
    def complete_task(self):
        self.completed += 1
        progress = int((self.completed / self.total) * 100)
        self.overall_progress.setValue(progress)
        self.overall_label.setText(f"Postęp: {progress}% ({self.completed}/{self.total})")
        if self.completed >= self.total: self.current_label.setText("✅ Zakończono!")

class StatusIndicator(QWidget):
    pulse_value = pyqtProperty(float, lambda self: self._pulse, lambda self, v: setattr(self, '_pulse', v) or self.update())
    def __init__(self, parent=None):
        super().__init__(parent)
        self.status, self.message, self.message_key = "ok", "System OK", "system_ok"
        self.setFixedHeight(60)
        self._pulse = 1.0
        self.anim = QPropertyAnimation(self, b"pulse_value"); self.anim.setDuration(2000); self.anim.setStartValue(0.3); self.anim.setEndValue(1.0); self.anim.setEasingCurve(QEasingCurve.Type.InOutSine); self.anim.setLoopCount(-1); self.anim.start()
    
    def set_status(self, status, message_key): self.status, self.message_key = status, message_key; self.update()
    
    def paintEvent(self, event):
        painter = QPainter(self); painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        colors = {"ok": QColor(34, 197, 94), "warning": QColor(245, 158, 11), "error": QColor(239, 68, 68)}
        status_color = colors.get(self.status, colors["ok"])
        
        pulse_color = QColor(status_color); pulse_color.setAlpha(int(100 * self._pulse))
        painter.setPen(QPen(pulse_color, 3)); painter.drawEllipse(QRectF(15, 15, 30, 30).adjusted(-5, -5, 5, 5))
        painter.setPen(status_color); painter.setBrush(status_color); painter.drawEllipse(15, 15, 30, 30)

class TerminalWidget(ProfessionalCard):
    def __init__(self, title="Terminal", icon="💻", parent=None):
        super().__init__(title, icon=icon, parent=parent)
        layout = QVBoxLayout(self.content_widget); layout.setContentsMargins(0,0,0,0)
        self.terminal_output = QTextEdit(); self.terminal_output.setReadOnly(True)
        self.terminal_output.setStyleSheet("background: #0f172a; color: #e2e8f0; font-family: 'Consolas', monospace; border: 1px solid #374151; border-radius: 6px; padding: 5px;")
        layout.addWidget(self.terminal_output)
    
    def append_output(self, text, type="stdout"):
        colors = {"stderr": "#ef4444", "error": "#ef4444", "info": "#60a5fa", "success": "#22c55e"}
        self.terminal_output.append(f"<span style='color: {colors.get(type, '#e2e8f0')};'>{text}</span>")
    def clear_output(self): self.terminal_output.clear()

class AutostartItemWidget(QWidget):
    remove_requested = pyqtSignal(dict)
    toggle_requested = pyqtSignal(dict, bool)

    def __init__(self, program_data, enable_text="Enable", disable_text="Disable", parent=None):
        super().__init__(parent)
        self.program_data = program_data
        self.enable_text, self.disable_text = enable_text, disable_text
        
        self.setStyleSheet("background: rgba(30, 41, 59, 0.3); border: 1px solid #374151; border-radius: 8px; padding: 10px;")
        layout = QHBoxLayout(self); layout.setContentsMargins(10, 5, 10, 5)

        info_layout = QVBoxLayout()
        name_label = QLabel(f'<b>{program_data.get("name", "Unknown")}</b>')
        path_label = QLabel(f'<i>{program_data.get("path", "")}</i>'); path_label.setStyleSheet("color: #94a3b8;")
        info_layout.addWidget(name_label); info_layout.addWidget(path_label)
        layout.addLayout(info_layout); layout.addStretch()

        self.toggle_button = ModernButton(secondary=True); self.toggle_button.setFixedWidth(90)
        self.toggle_button.clicked.connect(lambda: self.toggle_requested.emit(self.program_data, not self.program_data.get("enabled", False)))
        layout.addWidget(self.toggle_button)

        remove_button = ModernButton("🗑️", secondary=True); remove_button.setFixedWidth(40)
        remove_button.clicked.connect(lambda: self.remove_requested.emit(self.program_data))
        layout.addWidget(remove_button)
        
        self._update_toggle_button()

    def _update_toggle_button(self):
        is_enabled = self.program_data.get("enabled", False)
        self.toggle_button.setText(self.disable_text if is_enabled else self.enable_text)