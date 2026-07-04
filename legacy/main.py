import sys
import os
import json
import threading
import time
from pathlib import Path
import platform
import webbrowser
from PyQt6.QtWidgets import *
from PyQt6.QtCore import *
from PyQt6.QtGui import *
from PyQt6.QtCharts import * # Keep this import even if not directly used for QCharts widgets

try:
    import psutil
except ImportError:
    print("Installing psutil...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psutil"])
    import psutil

from backend import SystemBackend
from widgets import ProfessionalCard, ModernButton, SystemChart, ProgressWidget, StatusIndicator, TerminalWidget, AutostartItemWidget
from translations import get_translations

class SystemCareApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.translations_data = get_translations()
        self.current_lang = "pl" # Default language
        self.current_theme = "professional" # Default theme
        self.monitoring_active = True
        self.backend = SystemBackend()
        
        self.setWindowTitle(self.tr("app_name"))
        self.setMinimumSize(1500, 950)
        self.resize(1700, 1100)
        
        self.setWindowFlags(Qt.WindowType.Window | Qt.WindowType.WindowMinMaxButtonsHint | Qt.WindowType.WindowCloseButtonHint)
        
        # Corrected order: setup_ui first, then load_config
        self.setup_ui()
        self.load_config() # Load config after UI is set up
        self.apply_theme(self.current_theme) # Apply loaded theme
        self.update_ui_texts() # Update texts based on loaded language
        
        self.start_monitoring()
        self.start_resource_logging()

    def tr(self, key):
        """Translates a given key to the current language."""
        return self.translations_data.get(key, {}).get(self.current_lang, key)

    def apply_theme(self, theme_name):
        self.current_theme = theme_name
        if theme_name == "professional":
            style = """
            QMainWindow {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1, 
                    stop:0 #0a0a0f, stop:0.3 #1a1a2e, stop:0.7 #16213e, stop:1 #0f172a);
                color: #e2e8f0;
            }
            
            QWidget {
                color: #e2e8f0;
                font-family: 'Segoe UI', 'Arial', sans-serif;
            }
            
            /* Sidebar Styling */
            QWidget#sidebar {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #1e1b4b, stop:0.5 #312e81, stop:1 #1e3a8a);
                border-right: 2px solid #4338ca;
                border-radius: 0px;
            }
            
            /* Navigation Buttons */
            QPushButton#nav_button {
                background: rgba(99, 102, 241, 0.1);
                border: 1px solid rgba(99, 102, 241, 0.3);
                border-radius: 8px;
                padding: 16px 20px;
                color: #cbd5e1;
                font-size: 14px;
                font-weight: 600;
                text-align: left;
                margin: 4px 8px;
            }
            
            QPushButton#nav_button:hover {
                background: rgba(99, 102, 241, 0.2);
                border-color: #6366f1;
                color: #f1f5f9;
            }
            
            QPushButton#nav_button:pressed {
                background: rgba(99, 102, 241, 0.3);
            }
            
            QPushButton#nav_button[selected="true"] {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #6366f1, stop:1 #8b5cf6);
                border-color: #a855f7;
                color: white;
                font-weight: bold;
            }
            
            /* Headers */
            QLabel#main_title {
                color: #f8fafc;
                font-size: 32px;
                font-weight: bold;
                margin: 20px 0px 10px 0px;
            }
            
            QLabel#subtitle {
                color: #94a3b8;
                font-size: 16px;
                margin: 0px 0px 30px 0px;
            }
            
            QLabel#sidebar_title {
                color: #f1f5f9;
                font-size: 24px;
                font-weight: bold;
                margin: 20px 0px 5px 0px;
            }
            
            QLabel#sidebar_subtitle {
                color: #a5b4fc;
                font-size: 12px;
                margin: 0px 0px 30px 0px;
            }
            
            /* Content Area */
            QWidget#content_area {
                background: rgba(15, 23, 42, 0.3);
                border-radius: 12px;
                margin: 10px;
            }
            
            /* Scrollbars */
            QScrollBar:vertical {
                background: rgba(30, 41, 59, 0.5);
                width: 12px;
                border-radius: 6px;
            }
            
            QScrollBar::handle:vertical {
                background: #6366f1;
                border-radius: 6px;
                min-height: 20px;
            }
            
            QScrollBar::handle:vertical:hover {
                background: #8b5cf6;
            }
            """
        elif theme_name == "dark_blue":
            style = """
            QMainWindow {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1, 
                    stop:0 #0D1B2A, stop:0.3 #1B263B, stop:0.7 #2E4A62, stop:1 #415A77);
                color: #E0FBFC;
            }
            
            QWidget {
                color: #E0FBFC;
                font-family: 'Segoe UI', 'Arial', sans-serif;
            }
            
            /* Sidebar Styling */
            QWidget#sidebar {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #0D1B2A, stop:0.5 #1B263B, stop:1 #2E4A62);
                border-right: 2px solid #415A77;
                border-radius: 0px;
            }
            
            /* Navigation Buttons */
            QPushButton#nav_button {
                background: rgba(65, 90, 119, 0.1);
                border: 1px solid rgba(65, 90, 119, 0.3);
                border-radius: 8px;
                padding: 16px 20px;
                color: #A2D2FF;
                font-size: 14px;
                font-weight: 600;
                text-align: left;
                margin: 4px 8px;
            }
            
            QPushButton#nav_button:hover {
                background: rgba(65, 90, 119, 0.2);
                border-color: #A2D2FF;
                color: #E0FBFC;
            }
            
            QPushButton#nav_button:pressed {
                background: rgba(65, 90, 119, 0.3);
            }
            
            QPushButton#nav_button[selected="true"] {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #A2D2FF, stop:1 #BDE0FE);
                border-color: #BDE0FE;
                color: #0D1B2A;
                font-weight: bold;
            }
            
            /* Headers */
            QLabel#main_title {
                color: #E0FBFC;
                font-size: 32px;
                font-weight: bold;
                margin: 20px 0px 10px 0px;
            }
            
            QLabel#subtitle {
                color: #A2D2FF;
                font-size: 16px;
                margin: 0px 0px 30px 0px;
            }
            
            QLabel#sidebar_title {
                color: #E0FBFC;
                font-size: 24px;
                font-weight: bold;
                margin: 20px 0px 5px 0px;
            }
            
            QLabel#sidebar_subtitle {
                color: #A2D2FF;
                font-size: 12px;
                margin: 0px 0px 30px 0px;
            }
            
            /* Content Area */
            QWidget#content_area {
                background: rgba(13, 27, 42, 0.3);
                border-radius: 12px;
                margin: 10px;
            }
            
            /* Scrollbars */
            QScrollBar:vertical {
                background: rgba(46, 74, 98, 0.5);
                width: 12px;
                border-radius: 6px;
            }
            
            QScrollBar::handle:vertical {
                background: #A2D2FF;
                border-radius: 6px;
                min-height: 20px;
            }
            
            QScrollBar::handle:vertical:hover {
                background: #BDE0FE;
            }
            """
        else: # Default to professional if unknown
            style = self.apply_theme("professional")
            return

        self.setStyleSheet(style)
        # Re-polish all widgets to apply new stylesheet
        for widget in self.findChildren(QWidget):
            widget.style().unpolish(widget)
            widget.style().polish(widget)
        # No need to call update_ui_texts here, it's called after load_config

    def setup_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        main_layout = QHBoxLayout(central_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # Sidebar
        self.setup_sidebar(main_layout)
        
        # Main content area
        content_container = QWidget()
        content_container.setObjectName("content_area")
        content_layout = QVBoxLayout(content_container)
        content_layout.setContentsMargins(30, 30, 30, 30)
        
        self.content_stack = QStackedWidget()
        content_layout.addWidget(self.content_stack)
        
        main_layout.addWidget(content_container, 1)
        
        # Create pages
        self.create_dashboard_page()
        self.create_maintenance_page()
        self.create_file_finder_page()
        self.create_autostart_page()
        self.create_settings_page()
        
        # Show dashboard by default
        self.show_page(0)
        # Initial text update will happen after load_config and apply_theme

    def setup_sidebar(self, main_layout):
        sidebar = QWidget()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(320)
        
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(25, 40, 25, 30)
        sidebar_layout.setSpacing(15)
        
        # Title section
        self.sidebar_title = QLabel(self.tr("app_name").split(" ")[0])
        self.sidebar_title.setObjectName("sidebar_title")
        self.sidebar_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sidebar_layout.addWidget(self.sidebar_title)
        
        self.sidebar_subtitle = QLabel(self.tr("professional_suite"))
        self.sidebar_subtitle.setObjectName("sidebar_subtitle")
        self.sidebar_subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sidebar_layout.addWidget(self.sidebar_subtitle)
        
        # Status indicator
        self.status_indicator = StatusIndicator()
        sidebar_layout.addWidget(self.status_indicator)
        
        sidebar_layout.addSpacing(20)
        
        # Navigation buttons
        self.nav_buttons = []
        nav_items = [
            ("🏠", "dashboard", "Przegląd systemu"),
            ("🔧", "maintenance", "Zadania utrzymania"),
            ("📁", "file_finder", "Wyszukiwarka dużych plików"),
            ("⚡", "autostart", "Programy startowe"),
            ("⚙️", "settings", "Konfiguracja aplikacji")
        ]
        
        for i, (icon, key, desc) in enumerate(nav_items):
            btn = QPushButton(f"{icon}  {self.tr(key)}")
            btn.setObjectName("nav_button")
            btn.setToolTip(desc) # Tooltip can remain static or be translated later
            btn.clicked.connect(lambda checked, idx=i: self.show_page(idx))
            btn.setProperty("selected", "false")
            self.nav_buttons.append(btn)
            sidebar_layout.addWidget(btn)
        
        sidebar_layout.addStretch()
        
        # System info mini card
        self.sys_info_card = ProfessionalCard(self.tr("system_info"), compact=True)
        sys_info_layout = QVBoxLayout(self.sys_info_card.content_widget)
        
        sys_text = f"{platform.system()} {platform.release()}"
        self.sys_label = QLabel(sys_text) # Make sys_label an instance attribute
        self.sys_label.setStyleSheet("color: #94a3b8; font-size: 11px;")
        sys_info_layout.addWidget(self.sys_label)
        
        sidebar_layout.addWidget(self.sys_info_card)
        
        # Author credit
        author_label = QLabel("© 2024 Kosma Brzeżawski")
        author_label.setStyleSheet("color: #64748b; font-size: 10px; text-align: center; margin-top: 10px;")
        author_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        author_label.mousePressEvent = lambda e: webbrowser.open("https://github.com/kosmabb")
        author_label.setCursor(Qt.CursorShape.PointingHandCursor)
        sidebar_layout.addWidget(author_label)
        
        main_layout.addWidget(sidebar)
    
    def show_page(self, index):
        # Update button states
        for i, btn in enumerate(self.nav_buttons):
            btn.setProperty("selected", "true" if i == index else "false")
            btn.style().unpolish(btn)
            btn.style().polish(btn)
        
        self.content_stack.setCurrentIndex(index)
    
    def create_dashboard_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)
        
        # Header
        self.dashboard_header = QLabel(self.tr("dashboard"))
        self.dashboard_header.setObjectName("main_title")
        layout.addWidget(self.dashboard_header)
        
        self.dashboard_subtitle = QLabel(self.tr("monitor_performance_realtime")) # New translation key
        self.dashboard_subtitle.setObjectName("subtitle")
        layout.addWidget(self.dashboard_subtitle)
        
        # Real-time Stats grid
        stats_grid = QGridLayout()
        stats_grid.setSpacing(20)
        
        # CPU Card
        self.cpu_card = ProfessionalCard(self.tr("cpu_usage"), icon="🖥️")
        cpu_content = QVBoxLayout(self.cpu_card.content_widget)
        self.cpu_label = QLabel("0.0%")
        self.cpu_label.setStyleSheet("font-size: 42px; font-weight: bold; color: #6366f1; margin: 10px 0px;")
        self.cpu_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cpu_content.addWidget(self.cpu_label)
        self.cpu_chart = SystemChart("#6366f1")
        cpu_content.addWidget(self.cpu_chart)
        stats_grid.addWidget(self.cpu_card, 0, 0)
        
        # RAM Card
        self.ram_card = ProfessionalCard(self.tr("ram_usage"), icon="💾")
        ram_content = QVBoxLayout(self.ram_card.content_widget)
        self.ram_label = QLabel("0.0%")
        self.ram_label.setStyleSheet("font-size: 42px; font-weight: bold; color: #8b5cf6; margin: 10px 0px;")
        self.ram_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ram_content.addWidget(self.ram_label)
        self.ram_chart = SystemChart("#8b5cf6")
        ram_content.addWidget(self.ram_chart)
        stats_grid.addWidget(self.ram_card, 0, 1)
        
        # Disk Card
        self.disk_card = ProfessionalCard(self.tr("disk_usage"), icon="💿")
        disk_content = QVBoxLayout(self.disk_card.content_widget)
        self.disk_progress = QProgressBar()
        self.disk_progress.setStyleSheet("""
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
                    stop:0 #f59e0b, stop:1 #d97706);
                border-radius: 6px;
            }
        """)
        disk_content.addWidget(self.disk_progress)
        self.disk_info_label = QLabel(self.tr("loading")) # New translation key
        self.disk_info_label.setStyleSheet("color: #94a3b8; font-size: 14px; margin-top: 10px;")
        self.disk_info_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        disk_content.addWidget(self.disk_info_label)
        stats_grid.addWidget(self.disk_card, 1, 0, 1, 2)
        
        layout.addLayout(stats_grid)
        
        # System processes card
        self.processes_card = ProfessionalCard(self.tr("active_processes"), icon="⚙️") # New translation key
        processes_layout = QVBoxLayout(self.processes_card.content_widget)
        self.processes_list = QListWidget()
        self.processes_list.setStyleSheet("""
            QListWidget {
                background: rgba(30, 41, 59, 0.3);
                border: 1px solid #374151;
                border-radius: 8px;
                color: #e2e8f0;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 12px;
            }
            QListWidget::item {
                padding: 8px;
                border-bottom: 1px solid rgba(55, 65, 81, 0.5);
            }
            QListWidget::item:hover {
                background: rgba(99, 102, 241, 0.1);
            }
        """)
        processes_layout.addWidget(self.processes_list)
        layout.addWidget(self.processes_card)

        layout.addStretch()
        
        self.content_stack.addWidget(page)

    def create_maintenance_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        # Header
        self.maintenance_header = QLabel(self.tr("maintenance"))
        self.maintenance_header.setObjectName("main_title")
        layout.addWidget(self.maintenance_header)
        
        self.maintenance_subtitle = QLabel(self.tr("automatic_optimization_cleaning")) # New translation key
        self.maintenance_subtitle.setObjectName("subtitle")
        layout.addWidget(self.maintenance_subtitle)

        main_content_layout = QHBoxLayout()
        main_content_layout.setSpacing(20)

        # Left Column: Available Tasks & Terminal
        left_column_layout = QVBoxLayout()
        
        # Available Tasks Card
        tasks_card = ProfessionalCard(self.tr("available_tasks"), icon="📋")
        tasks_layout = QVBoxLayout(tasks_card.content_widget)
        tasks_layout.setSpacing(10)

        self.task_checkboxes = {}
        tasks_data = [
            ("diagnostics", "diagnostics", "diagnostics_desc", "🔍"),
            ("temp_folders", "temp_files_cleanup", "temp_files_cleanup_desc", "🗑️"),
            ("disk_cleanup", "disk_cleanup", "disk_cleanup_desc", "🧹"),
            ("empty_trash", "empty_trash", "empty_trash_desc", "♻️"),
            ("optimize_storage", "optimize_storage", "optimize_storage_desc", "⚡"),
            ("system_updates", "system_updates", "system_updates_desc", "🔄")
        ]

        for task_id, title_key, desc_key, icon_char in tasks_data:
            checkbox = QCheckBox(f"{icon_char} {self.tr(title_key)}")
            checkbox.setStyleSheet("""
                QCheckBox {
                    color: #e2e8f0;
                    font-size: 14px;
                    spacing: 10px;
                }
                QCheckBox::indicator {
                    width: 20px;
                    height: 20px;
                    border: 2px solid #64748b;
                    border-radius: 4px;
                    background: #1f2937;
                }
                QCheckBox::indicator:checked {
                    background: #6366f1;
                    border: 2px solid #6366f1;
                }
            """)
            self.task_checkboxes[task_id] = checkbox
            tasks_layout.addWidget(checkbox)
            
            desc_label = QLabel(self.tr(desc_key))
            desc_label.setStyleSheet("color: #94a3b8; font-size: 12px; margin-left: 30px;")
            tasks_layout.addWidget(desc_label)
        
        tasks_layout.addStretch()
        left_column_layout.addWidget(tasks_card)

        # Terminal Widget
        self.terminal_widget = TerminalWidget(self.tr("terminal"), icon="💻")
        left_column_layout.addWidget(self.terminal_widget)

        main_content_layout.addLayout(left_column_layout, 2) # Give more space to left column

        # Right Column: Presets, Progress, Control
        right_column_layout = QVBoxLayout()
        right_column_layout.setSpacing(20)

        # Presets Card
        presets_card = ProfessionalCard(self.tr("presets"), icon="⚡")
        presets_layout = QVBoxLayout(presets_card.content_widget)
        self.full_maintenance_btn = ModernButton(self.tr("full_maintenance"), primary=True, large=True)
        self.full_maintenance_btn.clicked.connect(self.select_full_preset)
        presets_layout.addWidget(self.full_maintenance_btn)
        self.disk_only_btn = ModernButton(self.tr("disk_only"), secondary=True, large=True)
        self.disk_only_btn.clicked.connect(self.select_disk_preset)
        presets_layout.addWidget(self.disk_only_btn)
        right_column_layout.addWidget(presets_card)

        # Progress Widget
        self.progress_widget = ProgressWidget()
        right_column_layout.addWidget(self.progress_widget)

        # Control Card
        control_card = ProfessionalCard(self.tr("control"), icon="⚙️")
        control_layout = QVBoxLayout(control_card.content_widget)
        self.shutdown_checkbox = QCheckBox(self.tr("shutdown_after_finish"))
        self.shutdown_checkbox.setStyleSheet("""
            QCheckBox {
                color: #e2e8f0;
                font-size: 14px;
                spacing: 10px;
            }
            QCheckBox::indicator {
                width: 20px;
                height: 20px;
                border: 2px solid #64748b;
                border-radius: 4px;
                background: #1f2937;
            }
            QCheckBox::indicator:checked {
                background: #f59e0b;
                border: 2px solid #f59e0b;
            }
        """)
        control_layout.addWidget(self.shutdown_checkbox)
        self.start_btn = ModernButton(self.tr("start_maintenance"), primary=True, large=True)
        self.start_btn.clicked.connect(self.start_maintenance)
        control_layout.addWidget(self.start_btn)
        right_column_layout.addWidget(control_card)

        right_column_layout.addStretch()
        main_content_layout.addLayout(right_column_layout, 1) # Give less space to right column

        layout.addLayout(main_content_layout)
        layout.addStretch()
        
        self.content_stack.addWidget(page)

    def create_file_finder_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        # Header
        self.file_finder_header = QLabel(self.tr("large_files_finder"))
        self.file_finder_header.setObjectName("main_title")
        layout.addWidget(self.file_finder_header)
        
        self.file_finder_subtitle = QLabel(self.tr("find_and_manage_large_files")) # New translation key
        self.file_finder_subtitle.setObjectName("subtitle")
        layout.addWidget(self.file_finder_subtitle)

        # Scan Settings Card
        self.scan_settings_card = ProfessionalCard(self.tr("scan_settings"), icon="⚙️")
        scan_settings_layout = QVBoxLayout(self.scan_settings_card.content_widget)
        
        folder_select_layout = QHBoxLayout()
        self.folder_path_label = QLabel(str(Path.home()))
        self.folder_path_label.setStyleSheet("color: #e2e8f0; font-size: 14px; padding: 8px; border: 1px solid #374151; border-radius: 6px; background: rgba(30, 41, 59, 0.5);")
        folder_select_layout.addWidget(self.folder_path_label)
        select_folder_btn = ModernButton(self.tr("select_folder"), secondary=True)
        select_folder_btn.clicked.connect(self.select_scan_folder)
        folder_select_layout.addWidget(select_folder_btn)
        scan_settings_layout.addLayout(folder_select_layout)

        files_count_layout = QHBoxLayout()
        self.files_count_label = QLabel("10")
        self.files_count_label.setStyleSheet("color: #e2e8f0; font-size: 14px; font-weight: bold;")
        files_count_layout.addWidget(QLabel(self.tr("number_of_files_to_find"))) # New translation key
        files_count_layout.addWidget(self.files_count_label)
        self.files_count_slider = QSlider(Qt.Orientation.Horizontal)
        self.files_count_slider.setRange(1, 100)
        self.files_count_slider.setValue(10)
        self.files_count_slider.setSingleStep(1)
        self.files_count_slider.valueChanged.connect(self.update_files_count_label)
        self.files_count_slider.setStyleSheet("""
            QSlider::groove:horizontal {
                border: 1px solid #374151;
                height: 8px;
                background: #1f2937;
                border-radius: 4px;
            }
            QSlider::handle:horizontal {
                background: #6366f1;
                border: 1px solid #6366f1;
                width: 18px;
                margin: -5px 0;
                border-radius: 9px;
            }
            QSlider::handle:horizontal:hover {
                background: #8b5cf6;
            }
        """)
        files_count_layout.addWidget(self.files_count_slider)
        scan_settings_layout.addLayout(files_count_layout)

        self.scan_btn = ModernButton(self.tr("start_scan"), primary=True, large=True)
        self.scan_btn.clicked.connect(self.start_file_scan)
        scan_settings_layout.addWidget(self.scan_btn)

        layout.addWidget(self.scan_settings_card)

        # Results List
        self.results_card = ProfessionalCard(self.tr("scan_results"), icon="📄") # New translation key
        results_layout = QVBoxLayout(self.results_card.content_widget)
        self.results_list = QListWidget()
        self.results_list.setStyleSheet("""
            QListWidget {
                background: rgba(30, 41, 59, 0.3);
                border: 1px solid #374151;
                border-radius: 8px;
                color: #e2e8f0;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 12px;
            }
            QListWidget::item {
                padding: 8px;
                border-bottom: 1px solid rgba(55, 65, 81, 0.5);
            }
            QListWidget::item:hover {
                background: rgba(99, 102, 241, 0.1);
            }
        """)
        results_layout.addWidget(self.results_list)
        layout.addWidget(self.results_card)

        layout.addStretch()
        self.content_stack.addWidget(page)

    def create_autostart_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        # Header
        self.autostart_header = QLabel(self.tr("autostart_management"))
        self.autostart_header.setObjectName("main_title")
        layout.addWidget(self.autostart_header)
        
        self.autostart_subtitle = QLabel(self.tr("manage_startup_programs")) # New translation key
        self.autostart_subtitle.setObjectName("subtitle")
        layout.addWidget(self.autostart_subtitle)

        # Add Program Card
        self.add_program_card = ProfessionalCard(self.tr("add_autostart_program"), icon="➕")
        add_program_layout = QFormLayout(self.add_program_card.content_widget)
        add_program_layout.setContentsMargins(10, 10, 10, 10)
        add_program_layout.setSpacing(10)

        self.program_name_input = QLineEdit()
        self.program_name_input.setPlaceholderText(self.tr("program_name_placeholder")) # New translation key
        self.program_name_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                border: 1px solid #374151;
                border-radius: 4px;
                background: rgba(30, 41, 59, 0.5);
                color: #e2e8f0;
            }
        """)
        add_program_layout.addRow(self.tr("program_name"), self.program_name_input)

        path_select_layout = QHBoxLayout()
        self.program_path_input = QLineEdit()
        self.program_path_input.setPlaceholderText(self.tr("program_path_placeholder")) # New translation key
        self.program_path_input.setStyleSheet("""
            QLineEdit {
                padding: 8px;
                border: 1px solid #374151;
                border-radius: 4px;
                background: rgba(30, 41, 59, 0.5);
                color: #e2e8f0;
            }
        """)
        path_select_layout.addWidget(self.program_path_input)
        browse_path_btn = ModernButton("...", secondary=True)
        browse_path_btn.setFixedWidth(40)
        browse_path_btn.clicked.connect(self.select_program_path)
        path_select_layout.addWidget(browse_path_btn)
        add_program_layout.addRow(self.tr("program_path"), path_select_layout)

        add_button = ModernButton(self.tr("add"), primary=True)
        add_button.setObjectName("add_button") # Added object name for easier lookup
        add_button.clicked.connect(self.add_autostart_program)
        add_program_layout.addRow(add_button)

        layout.addWidget(self.add_program_card)

        # Autostart Programs List
        self.autostart_list_card = ProfessionalCard(self.tr("startup_programs_list"), icon="📄") # New translation key
        autostart_list_layout = QVBoxLayout(self.autostart_list_card.content_widget)
        
        self.autostart_list = QListWidget()
        self.autostart_list.setStyleSheet("""
            QListWidget {
                background: rgba(30, 41, 59, 0.3);
                border: 1px solid #374151;
                border-radius: 8px;
                color: #e2e8f0;
                font-family: 'Segoe UI', 'Arial', sans-serif;
                font-size: 12px;
            }
            QListWidget::item {
                margin-bottom: 5px; /* Spacing between custom items */
            }
        """)
        autostart_list_layout.addWidget(self.autostart_list)

        self.refresh_btn = ModernButton(self.tr("refresh_list"), secondary=True)
        self.refresh_btn.clicked.connect(self.refresh_autostart_list)
        autostart_list_layout.addWidget(self.refresh_btn)

        layout.addWidget(self.autostart_list_card)
        layout.addStretch()
        self.content_stack.addWidget(page)

    def create_settings_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        # Header
        self.settings_header = QLabel(self.tr("app_settings"))
        self.settings_header.setObjectName("main_title")
        layout.addWidget(self.settings_header)
        
        self.settings_subtitle = QLabel(self.tr("configure_application_settings")) # New translation key
        self.settings_subtitle.setObjectName("subtitle")
        layout.addWidget(self.settings_subtitle)

        # Settings Card
        self.settings_card = ProfessionalCard(self.tr("app_settings"), icon="⚙️")
        self.settings_layout = QFormLayout(self.settings_card.content_widget) # Make settings_layout an instance attribute
        self.settings_layout.setContentsMargins(10, 10, 10, 10)
        self.settings_layout.setSpacing(10)

        # Language selection
        self.lang_combo = QComboBox()
        self.lang_combo.addItems(["Polski", "English"])
        self.lang_combo.currentIndexChanged.connect(self.change_language)
        self.lang_combo.setStyleSheet("""
            QComboBox {
                padding: 8px;
                border: 1px solid #374151;
                border-radius: 4px;
                background: rgba(30, 41, 59, 0.5);
                color: #e2e8f0;
            }
            QComboBox::drop-down {
                border: 0px; /* No border for the arrow */
            }
            QComboBox::down-arrow {
                image: url(./icons/arrow_down.png); /* Placeholder for a custom arrow icon */
                width: 12px;
                height: 12px;
            }
            QComboBox QAbstractItemView {
                background: #1f2937;
                border: 1px solid #374151;
                selection-background-color: #6366f1;
                color: #e2e8f0;
            }
        """)
        self.settings_layout.addRow(self.tr("language"), self.lang_combo)

        # Theme selection
        self.theme_combo = QComboBox()
        self.theme_combo.addItems([self.tr("professional_theme"), self.tr("dark_blue_theme")]) # New translation keys
        self.theme_combo.currentIndexChanged.connect(self.change_theme)
        self.theme_combo.setStyleSheet(self.lang_combo.styleSheet()) # Reuse style
        self.settings_layout.addRow(self.tr("theme"), self.theme_combo)

        # Export system report button
        self.export_report_btn = ModernButton(self.tr("export_report"), secondary=True)
        self.export_report_btn.clicked.connect(self.export_system_info)
        self.settings_layout.addRow(self.tr("export_data"), self.export_report_btn)

        # Save settings button
        self.save_settings_btn = ModernButton(self.tr("save_settings"), primary=True)
        self.save_settings_btn.clicked.connect(self.save_settings)
        self.settings_layout.addRow(self.save_settings_btn)

        layout.addWidget(self.settings_card)
        layout.addStretch()
        self.content_stack.addWidget(page)

    def update_ui_texts(self):
        # Update sidebar texts
        self.sidebar_title.setText(self.tr("app_name").split(" ")[0])
        self.sidebar_subtitle.setText(self.tr("professional_suite"))
        self.status_indicator.set_status(self.status_indicator.status, self.tr("system_ok")) # Update status indicator message
        # Użyj nowej nazwy obiektu "card_title_label"
        if self.sys_info_card.findChild(QLabel, "card_title_label"):
            self.sys_info_card.findChild(QLabel, "card_title_label").setText(self.tr("system_info")) # Update card title
        self.sys_label.setText(f"{platform.system()} {platform.release()}") # Update sys_label directly

        # Update nav buttons
        nav_items = [
            ("🏠", "dashboard"),
            ("🔧", "maintenance"),
            ("📁", "file_finder"),
            ("⚡", "autostart"),
            ("⚙️", "settings")
        ]
        for i, (icon, key) in enumerate(nav_items):
            self.nav_buttons[i].setText(f"{icon}  {self.tr(key)}")

        # Update Dashboard page texts
        self.dashboard_header.setText(self.tr("dashboard"))
        self.dashboard_subtitle.setText(self.tr("monitor_performance_realtime"))
        if self.cpu_card.findChild(QLabel, "card_title_label"):
            self.cpu_card.findChild(QLabel, "card_title_label").setText(self.tr("cpu_usage"))
        if self.ram_card.findChild(QLabel, "card_title_label"):
            self.ram_card.findChild(QLabel, "card_title_label").setText(self.tr("ram_usage"))
        if self.disk_card.findChild(QLabel, "card_title_label"):
            self.disk_card.findChild(QLabel, "card_title_label").setText(self.tr("disk_usage"))
        # Check if disk_info_label has content before updating with 'loading'
        if self.disk_info_label.text() == self.tr("loading") or "GB" not in self.disk_info_label.text():
            self.disk_info_label.setText(self.tr("loading"))
        if self.processes_card.findChild(QLabel, "card_title_label"):
            self.processes_card.findChild(QLabel, "card_title_label").setText(self.tr("active_processes"))

        # Update Maintenance page texts
        self.maintenance_header.setText(self.tr("maintenance"))
        self.maintenance_subtitle.setText(self.tr("automatic_optimization_cleaning"))
        if self.progress_widget.findChild(QLabel, "card_title_label"):
            self.progress_widget.findChild(QLabel, "card_title_label").setText(self.tr("operation_progress"))
        self.progress_widget.overall_label.setText(self.tr("ready_to_start"))
        self.progress_widget.current_label.setText(self.tr("waiting_to_start"))
        if self.terminal_widget.findChild(QLabel, "card_title_label"):
            self.terminal_widget.findChild(QLabel, "card_title_label").setText(self.tr("terminal"))
        
        self.full_maintenance_btn.setText(self.tr("full_maintenance"))
        self.disk_only_btn.setText(self.tr("disk_only"))
        
        # Update task checkboxes and descriptions
        tasks_data = {
            "diagnostics": ("🔍", "diagnostics", "diagnostics_desc"),
            "temp_folders": ("🗑️", "temp_files_cleanup", "temp_files_cleanup_desc"),
            "disk_cleanup": ("🧹", "disk_cleanup", "disk_cleanup_desc"),
            "empty_trash": ("♻️", "empty_trash", "empty_trash_desc"),
            "optimize_storage": ("⚡", "optimize_storage", "optimize_storage_desc"),
            "system_updates": ("🔄", "system_updates", "system_updates_desc")
        }
        for task_id, (icon_char, title_key, desc_key) in tasks_data.items():
            if task_id in self.task_checkboxes:
                self.task_checkboxes[task_id].setText(f"{icon_char} {self.tr(title_key)}")
                # Assuming the description label is the next widget in the layout after the checkbox
                # This is a bit fragile, but works if structure is consistent
                parent_layout = self.task_checkboxes[task_id].parentWidget().layout()
                if parent_layout:
                    idx = parent_layout.indexOf(self.task_checkboxes[task_id])
                    if idx != -1 and idx + 1 < parent_layout.count():
                        item = parent_layout.itemAt(idx + 1)
                        if item and item.widget() and isinstance(item.widget(), QLabel):
                            item.widget().setText(self.tr(desc_key))

        self.shutdown_checkbox.setText(self.tr("shutdown_after_finish"))
        self.start_btn.setText(self.tr("start_maintenance"))

        # Update File Finder page texts
        self.file_finder_header.setText(self.tr("large_files_finder"))
        self.file_finder_subtitle.setText(self.tr("find_and_manage_large_files"))
        self.scan_btn.setText(self.tr("start_scan"))
        if self.scan_settings_card.findChild(QLabel, "card_title_label"):
            self.scan_settings_card.findChild(QLabel, "card_title_label").setText(self.tr("scan_settings"))
        # Update "Number of files to find" label
        # Assuming the label is directly before self.files_count_label in its layout
        files_count_layout_widgets = self.files_count_slider.parentWidget().layout()
        if files_count_layout_widgets:
            for i in range(files_count_layout_widgets.count()):
                widget = files_count_layout_widgets.itemAt(i).widget()
                if widget and widget is self.files_count_label:
                    # The label before files_count_label is the one we want to update
                    if i > 0:
                        prev_widget = files_count_layout_widgets.itemAt(i-1).widget()
                        if isinstance(prev_widget, QLabel):
                            prev_widget.setText(self.tr("number_of_files_to_find"))
                    break

        self.scan_btn.setText(self.tr("start_scan"))
        if self.results_card.findChild(QLabel, "card_title_label"):
            self.results_card.findChild(QLabel, "card_title_label").setText(self.tr("scan_results"))

        # Update Autostart page texts
        self.autostart_header.setText(self.tr("autostart_management"))
        self.autostart_subtitle.setText(self.tr("manage_startup_programs"))
        self.program_name_input.setPlaceholderText(self.tr("program_name_placeholder"))
        self.program_path_input.setPlaceholderText(self.tr("program_path_placeholder"))
        if self.add_program_card.findChild(QLabel, "card_title_label"):
            self.add_program_card.findChild(QLabel, "card_title_label").setText(self.tr("add_autostart_program"))
        # Find the labels for "Program Name" and "Program Path" in the form layout
        form_layout = self.add_program_card.content_widget.layout()
        if isinstance(form_layout, QFormLayout):
            for i in range(form_layout.rowCount()):
                item = form_layout.itemAt(i, QFormLayout.ItemRole.LabelRole)
                if item: # Dodano sprawdzenie, czy item nie jest None
                    label_widget = item.widget()
                    if label_widget:
                        # Check current text to identify which label it is
                        if label_widget.text() in ["Nazwa programu:", "Program Name:"]:
                            label_widget.setText(self.tr("program_name"))
                        elif label_widget.text() in ["Ścieżka programu:", "Program Path:"]:
                            label_widget.setText(self.tr("program_path"))

        self.add_program_card.findChild(ModernButton, "add_button").setText(self.tr("add"))
        if self.autostart_list_card.findChild(QLabel, "card_title_label"):
            self.autostart_list_card.findChild(QLabel, "card_title_label").setText(self.tr("startup_programs_list"))
        self.refresh_btn.setText(self.tr("refresh_list"))
        # Update existing autostart items
        for i in range(self.autostart_list.count()):
            item_widget = self.autostart_list.itemWidget(self.autostart_list.item(i))
            if isinstance(item_widget, AutostartItemWidget):
                # Re-fetch translated texts for buttons within AutostartItemWidget
                item_widget.toggle_button.setText(self.tr("enable") if not item_widget.program_data.get("enabled", False) else self.tr("disable"))
                item_widget.findChild(QLabel, "name_label").setText(item_widget.program_data.get("name", self.tr("unknown")))
                item_widget.findChild(QLabel, "path_label").setText(item_widget.program_data.get("path", ""))


        # Update Settings page texts
        self.settings_header.setText(self.tr("app_settings"))
        self.settings_subtitle.setText(self.tr("configure_application_settings"))
        if self.settings_card.findChild(QLabel, "card_title_label"):
            self.settings_card.findChild(QLabel, "card_title_label").setText(self.tr("app_settings"))
        
        # Update language combo box labels using self.settings_layout
        if isinstance(self.settings_layout, QFormLayout):
            item = self.settings_layout.itemAt(0, QFormLayout.ItemRole.LabelRole)
            if item: # Dodano sprawdzenie, czy item nie jest None
                lang_label_widget = item.widget()
                if isinstance(lang_label_widget, QLabel):
                    lang_label_widget.setText(self.tr("language"))

            # Update theme combo box labels using self.settings_layout
            item = self.settings_layout.itemAt(1, QFormLayout.ItemRole.LabelRole)
            if item: # Dodano sprawdzenie, czy item nie jest None
                theme_label_widget = item.widget()
                if isinstance(theme_label_widget, QLabel):
                    theme_label_widget.setText(self.tr("theme"))

            # Update export data label
            item = self.settings_layout.itemAt(2, QFormLayout.ItemRole.LabelRole)
            if item: # Dodano sprawdzenie, czy item nie jest None
                export_data_label_widget = item.widget()
                if isinstance(export_data_label_widget, QLabel):
                    export_data_label_widget.setText(self.tr("export_data"))

        # Update combo box items with current translations
        self.lang_combo.setItemText(0, self.tr("polish"))
        self.lang_combo.setItemText(1, self.tr("english"))
        self.theme_combo.setItemText(0, self.tr("professional_theme"))
        self.theme_combo.setItemText(1, self.tr("dark_blue_theme"))

        self.export_report_btn.setText(self.tr("export_report"))
        self.save_settings_btn.setText(self.tr("save_settings"))


    def change_language(self, index):
        self.current_lang = "pl" if index == 0 else "en"
        self.update_ui_texts()
        self.save_settings() # Save language setting

    def change_theme(self, index):
        theme_map = {
            0: "professional",
            1: "dark_blue"
        }
        selected_theme = theme_map.get(index, "professional")
        self.apply_theme(selected_theme)
        self.save_settings() # Save theme setting

    def start_monitoring(self):
        self.monitor_timer = QTimer()
        self.monitor_timer.timeout.connect(self.update_system_stats)
        self.monitor_timer.start(1000)  # Update every second
        
        # Update processes every 5 seconds
        self.process_timer = QTimer()
        self.process_timer.timeout.connect(self.update_processes)
        self.process_timer.start(5000)

    def update_system_stats(self):
        if not self.monitoring_active:
            return
            
        # CPU
        cpu_percent = psutil.cpu_percent()
        self.cpu_label.setText(f"{cpu_percent:.1f}%")
        self.cpu_chart.add_data_point(cpu_percent)
        
        # RAM
        ram = psutil.virtual_memory()
        self.ram_label.setText(f"{ram.percent:.1f}%")
        self.ram_chart.add_data_point(ram.percent)
        
        # Disk
        try:
            disk = psutil.disk_usage(Path.home().anchor)
            self.disk_progress.setValue(int(disk.percent))
            gb = 1024**3
            self.disk_info_label.setText(f"{disk.used/gb:.1f} GB / {disk.total/gb:.1f} GB {self.tr('used')}") # New translation key
        except:
            self.disk_info_label.setText(self.tr("disk_read_error")) # New translation key
        
        # Update status indicator
        if hasattr(self, 'status_indicator'):
            if cpu_percent > 80 or ram.percent > 85:
                self.status_indicator.set_status("warning", self.tr("high_load"))
            elif cpu_percent > 90 or ram.percent > 95:
                self.status_indicator.set_status("error", self.tr("critical_load"))
            else:
                self.status_indicator.set_status("ok", self.tr("system_ok"))
    
    def update_processes(self):
        if not hasattr(self, 'processes_list'):
            return
            
        try:
            processes = []
            for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
                try:
                    processes.append(proc.info)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            # Sort by CPU usage
            processes.sort(key=lambda x: x['cpu_percent'] or 0, reverse=True)
            
            self.processes_list.clear()
            for proc in processes[:10]:  # Top 10 processes
                cpu = proc['cpu_percent'] or 0
                mem = proc['memory_percent'] or 0
                item_text = f"PID: {proc['pid']:>6} | CPU: {cpu:>5.1f}% | RAM: {mem:>5.1f}% | {proc['name']}"
                self.processes_list.addItem(item_text)
        except Exception as e:
            pass

    def start_resource_logging(self):
        self.logger_timer = QTimer()
        self.logger_timer.timeout.connect(self.log_current_resources)
        self.logger_timer.start(10000) # Log every 10 seconds

    def log_current_resources(self):
        if not self.monitoring_active:
            return
        
        cpu_percent = psutil.cpu_percent()
        ram = psutil.virtual_memory()
        disk = psutil.disk_usage(Path.home().anchor)
        
        top_processes_data = []
        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
            try:
                top_processes_data.append({
                    'pid': proc.info['pid'],
                    'name': proc.info['name'],
                    'cpu': proc.info['cpu_percent'],
                    'ram': proc.info['memory_percent']
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        
        # Sort by CPU usage and take top 5
        top_processes_data.sort(key=lambda x: x['cpu'] or 0, reverse=True)
        top_processes_data = top_processes_data[:5]

        self.backend.log_resource_usage(cpu_percent, ram.percent, disk.percent, top_processes_data)

    def select_full_preset(self):
        for checkbox in self.task_checkboxes.values():
            checkbox.setChecked(True)

    def select_disk_preset(self):
        disk_tasks = ["disk_cleanup", "optimize_storage", "empty_trash"] # Added empty_trash to disk preset
        for task_id, checkbox in self.task_checkboxes.items():
            checkbox.setChecked(task_id in disk_tasks)

    def start_maintenance(self):
        selected_tasks = [task_id for task_id, checkbox in self.task_checkboxes.items() if checkbox.isChecked()]
        if not selected_tasks:
            QMessageBox.warning(self, self.tr("warning"), self.tr("no_tasks_selected"))
            return
        
        self.start_btn.setEnabled(False)
        self.progress_widget.start_progress(len(selected_tasks))
        self.terminal_widget.terminal_output.clear() # Clear terminal before new run
        self.terminal_widget.append_output(self.tr("starting_maintenance"), "info")
        
        # Start maintenance in separate thread
        self.maintenance_thread = MaintenanceThread(selected_tasks, self.backend, self.current_lang)
        self.maintenance_thread.progress_updated.connect(self.progress_widget.update_progress)
        self.maintenance_thread.task_completed.connect(self.progress_widget.complete_task)
        self.maintenance_thread.command_output.connect(self.terminal_widget.append_output) # Connect to terminal
        self.maintenance_thread.finished.connect(self.maintenance_finished)
        self.maintenance_thread.start()

    def maintenance_finished(self):
        self.start_btn.setEnabled(True)
        QMessageBox.information(self, self.tr("success"), self.tr("maintenance_finished"))
        
        if self.shutdown_checkbox.isChecked():
            reply = QMessageBox.question(self, self.tr("shutdown"), 
                                   self.tr("confirm_shutdown"),
                                   QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if reply == QMessageBox.StandardButton.Yes:
                self.backend.shutdown_system()

    def select_scan_folder(self):
        folder = QFileDialog.getExistingDirectory(self, self.tr("select_folder"))
        if folder:
            self.folder_path_label.setText(folder)

    def update_files_count_label(self, value):
        self.files_count_label.setText(str(value))

    def start_file_scan(self):
        folder_path = self.folder_path_label.text()
        if not os.path.isdir(folder_path):
            QMessageBox.warning(self, self.tr("error"), self.tr("select_valid_folder"))
            return
        
        self.scan_btn.setEnabled(False)
        self.scan_btn.setText(self.tr("scanning"))
        self.results_list.clear()
        
        files_count = self.files_count_slider.value()
        
        self.scan_thread = FileScanThread(folder_path, files_count, self.backend)
        self.scan_thread.files_found.connect(self.update_scan_results)
        self.scan_thread.finished.connect(self.scan_finished)
        self.scan_thread.start()

    def update_scan_results(self, files):
        self.results_list.clear()
        for size, path in files:
            size_mb = size / (1024 * 1024)
            if size_mb >= 1024:
                size_str = f"{size_mb/1024:.2f} GB"
            else:
                size_str = f"{size_mb:.2f} MB"
            
            item_text = f"{size_str:>10} | {path.name}\n{'':>12} {path.parent}"
            
            item = QListWidgetItem(item_text)
            item.setData(Qt.ItemDataRole.UserRole, str(path))
            self.results_list.addItem(item)
        
        self.results_list.itemDoubleClicked.connect(self.open_file_location)

    def open_file_location(self, item):
        file_path = item.data(Qt.ItemDataRole.UserRole)
        self.backend.open_file_location(file_path)

    def scan_finished(self):
        self.scan_btn.setEnabled(True)
        self.scan_btn.setText(self.tr("start_scan"))

    def refresh_autostart_list(self):
        self.autostart_list.clear()
        
        self.autostart_thread = AutostartThread(self.backend)
        self.autostart_thread.programs_loaded.connect(self.update_autostart_list)
        self.autostart_thread.start()

    def update_autostart_list(self, programs):
        self.autostart_list.clear()
        for program in programs:
            item = QListWidgetItem(self.autostart_list)
            item_widget = AutostartItemWidget(program)
            item_widget.remove_requested.connect(self.remove_autostart_program)
            item_widget.toggle_requested.connect(self.toggle_autostart_program)
            item.setSizeHint(item_widget.sizeHint())
            self.autostart_list.addItem(item)
            self.autostart_list.setItemWidget(item, item_widget)

    def select_program_path(self):
        file_path, _ = QFileDialog.getOpenFileName(self, self.tr("select_program_path"), "", "All Files (*);;Executable Files (*.exe *.app *.sh)") # New translation key
        if file_path:
            self.program_path_input.setText(file_path)

    def add_autostart_program(self):
        name = self.program_name_input.text().strip()
        path = self.program_path_input.text().strip()

        if not name or not path:
            QMessageBox.warning(self, self.tr("warning"), self.tr("name_path_required"))
            return
        
        if self.backend.add_startup_program(name, path, live_output_callback=self.terminal_widget.append_output):
            QMessageBox.information(self, self.tr("success"), self.tr("program_added"))
            self.program_name_input.clear()
            self.program_path_input.clear()
            self.refresh_autostart_list()
        else:
            QMessageBox.critical(self, self.tr("error"), self.tr("failed_to_add_program")) # New translation key

    def remove_autostart_program(self, program_data):
        reply = QMessageBox.question(self, self.tr("remove_program"), 
                                   self.tr("confirm_remove"),
                                   QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if reply == QMessageBox.StandardButton.Yes:
            if self.backend.remove_startup_program(program_data, live_output_callback=self.terminal_widget.append_output):
                QMessageBox.information(self, self.tr("success"), self.tr("program_removed"))
                self.refresh_autostart_list()
            else:
                QMessageBox.critical(self, self.tr("error"), self.tr("failed_to_remove_program")) # New translation key

    def toggle_autostart_program(self, program_data, enable):
        if self.backend.toggle_startup_program(program_data, enable, live_output_callback=self.terminal_widget.append_output):
            program_data["enabled"] = enable # Update local data
            # Find the item widget and update its state
            for i in range(self.autostart_list.count()):
                item_widget = self.autostart_list.itemWidget(self.autostart_list.item(i))
                if item_widget and item_widget.program_data == program_data: # Simple comparison, might need unique ID
                    item_widget.update_program_data(program_data)
                    break
            
            if enable:
                QMessageBox.information(self, self.tr("success"), self.tr("program_enabled"))
            else:
                QMessageBox.information(self, self.tr("success"), self.tr("program_disabled"))
        else:
            QMessageBox.critical(self, self.tr("error"), self.tr("failed_to_toggle_program")) # New translation key


    def export_system_info(self):
        file_path, _ = QFileDialog.getSaveFileName(
            self, self.tr("save_system_report"), 
            f"system_report_{int(time.time())}.txt",
            "Text files (*.txt)"
        )
        if file_path:
            self.backend.export_system_info(file_path)
            QMessageBox.information(self, self.tr("success"), self.tr("report_exported"))

    def save_settings(self):
        config = {
            "language": self.lang_combo.currentText(),
            "theme": self.theme_combo.currentText(),
            "shutdown_on_finish": self.shutdown_checkbox.isChecked(),
        }
        
        with open("config.json", "w") as f:
            json.dump(config, f, indent=4)
        
        QMessageBox.information(self, self.tr("success"), self.tr("settings_saved"))

    def load_config(self):
        try:
            with open("config.json", "r") as f:
                config = json.load(f)
            
            # Load language
            lang_text = config.get("language", "Polski")
            if lang_text == "Polski":
                self.current_lang = "pl"
                self.lang_combo.setCurrentIndex(0)
            else:
                self.current_lang = "en"
                self.lang_combo.setCurrentIndex(1)
            
            # Load theme
            theme_text = config.get("theme", self.tr("professional_theme"))
            # Use the actual translated strings for comparison
            if theme_text == self.tr("professional_theme"):
                self.current_theme = "professional"
                self.theme_combo.setCurrentIndex(0)
            elif theme_text == self.tr("dark_blue_theme"):
                self.current_theme = "dark_blue"
                self.theme_combo.setCurrentIndex(1)
            else:
                self.current_theme = "professional" # Fallback
                self.theme_combo.setCurrentIndex(0)

            self.shutdown_checkbox.setChecked(config.get("shutdown_on_finish", False))

        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"Error loading config: {e}")
            # Fallback to defaults if config is corrupted
            self.current_lang = "pl"
            self.current_theme = "professional"
            self.shutdown_checkbox.setChecked(False)


    def closeEvent(self, event):
        self.monitoring_active = False
        if hasattr(self, 'logger_timer'):
            self.logger_timer.stop() # Stop logging timer
        if hasattr(self, 'monitor_timer'):
            self.monitor_timer.stop()
        if hasattr(self, 'process_timer'):
            self.process_timer.stop()
        event.accept()

# New Thread for Maintenance
class MaintenanceThread(QThread):
    progress_updated = pyqtSignal(str)
    task_completed = pyqtSignal()
    command_output = pyqtSignal(str, str) # text, type (stdout/stderr/info/error)

    def __init__(self, tasks, backend, lang):
        super().__init__()
        self.tasks = tasks
        self.backend = backend
        self.translations_data = get_translations()
        self.current_lang = lang

    def tr(self, key):
        return self.translations_data.get(key, {}).get(self.current_lang, key)

    def _live_output_callback(self, text, type):
        self.command_output.emit(text, type)

    def run(self):
        task_functions = {
            "diagnostics": self.backend.run_diagnostics,
            "temp_folders": self.backend.clean_temp_folders,
            "disk_cleanup": self.backend.cleanup_disk_space,
            "empty_trash": self.backend.empty_trash,
            "optimize_storage": self.backend.optimize_storage,
            "system_updates": self.backend.run_system_updates
        }
        
        task_names_map = {
            "diagnostics": self.tr("diagnostics"),
            "temp_folders": self.tr("temp_files_cleanup"),
            "disk_cleanup": self.tr("disk_cleanup"),
            "empty_trash": self.tr("empty_trash"),
            "optimize_storage": self.tr("optimize_storage"),
            "system_updates": self.tr("system_updates")
        }

        for task_id in self.tasks:
            task_name = task_names_map.get(task_id, task_id)
            self.progress_updated.emit(f"{self.tr('executing')} {task_name}")
            self.command_output.emit(f"\n{self.tr('starting_task')} {task_name} ---", "info")
            
            if task_id in task_functions:
                task_functions[task_id](live_output_callback=self._live_output_callback)
            else:
                self.command_output.emit(f"{self.tr('unknown_task')} {task_id}", "error")
            
            self.command_output.emit(f"{self.tr('task_completed')} {task_name} ---\n", "success")
            self.task_completed.emit()
            time.sleep(0.5)  # Small delay for visual feedback

class FileScanThread(QThread):
    files_found = pyqtSignal(list)

    def __init__(self, path, count, backend):
        super().__init__()
        self.path = path
        self.count = count
        self.backend = backend

    def run(self):
        def update_callback(files):
            self.files_found.emit(files)
        
        self.backend.find_large_files(self.path, self.count, update_callback)

class AutostartThread(QThread):
    programs_loaded = pyqtSignal(list)

    def __init__(self, backend):
        super().__init__()
        self.backend = backend

    def run(self):
        programs = self.backend.get_startup_programs()
        self.programs_loaded.emit(programs)

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    app.setApplicationName("System Care Professional")
    app.setApplicationVersion("2.0")
    app.setOrganizationName("Kosma Brzeżawski")
    
    window = SystemCareApp()
    window.show()
    
    sys.exit(app.exec())
