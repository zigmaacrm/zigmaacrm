"use client";

import React, { useState, useRef } from "react";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  X,
  FileText,
  Loader2
} from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { api } from "@/lib/api";
import { useToast } from "@/components/common/ToastProvider";

interface BulkUploadContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BulkUploadContactsModal({
  isOpen,
  onClose,
  onSuccess
}: BulkUploadContactsModalProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (selectedFile: File) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setError("");

    const isExcel =
      selectedFile.name.endsWith(".xlsx") ||
      selectedFile.name.endsWith(".xls") ||
      selectedFile.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      selectedFile.type === "application/vnd.ms-excel";

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result;
          const workbook = XLSX.read(buffer, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

          if (data && data.length > 0) {
            setParsedRows(data);
            setPreviewRows(data.slice(0, 5));
          } else {
            setError("The selected Excel sheet has no data rows.");
          }
        } catch (err: any) {
          setError(`Failed to parse Excel file: ${err.message}`);
        }
      };
      reader.onerror = () => {
        setError("Failed to read the Excel file.");
      };
      reader.readAsArrayBuffer(selectedFile);
    } else {
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            setParsedRows(results.data);
            setPreviewRows(results.data.slice(0, 5));
          } else {
            setError("The selected file is empty or could not be parsed.");
          }
        },
        error: (err) => {
          setError(`Failed to parse file: ${err.message}`);
        }
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const downloadSampleTemplate = () => {
    const sampleData = [
      {
        name: "Ramesh Chandran",
        phone: "+91 98401 12345",
        email: "ramesh@techcorp.com",
        company_name: "TechCorp India",
        job_title: "Director",
        source: "Meta Ads",
        lifecycle_stage: "New"
      },
      {
        name: "Sunita Sharma",
        phone: "+91 98123 77889",
        email: "sunita@nexus.co",
        company_name: "Nexus Solutions",
        job_title: "VP Sales",
        source: "Google Ads",
        lifecycle_stage: "Contacted"
      },
      {
        name: "Vijay Raman",
        phone: "+91 97654 11223",
        email: "vijay@apex.in",
        company_name: "Apex Tech",
        job_title: "Product Manager",
        source: "Website Form",
        lifecycle_stage: "Qualified"
      },
      {
        name: "Kavita Krishnan",
        phone: "+91 99887 44556",
        email: "kavita@krishnan.org",
        company_name: "Krishnan & Co",
        job_title: "Founder",
        source: "WhatsApp",
        lifecycle_stage: "Customer"
      }
    ];

    try {
      const ws = XLSX.utils.json_to_sheet(sampleData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Contacts");
      XLSX.writeFile(wb, "zigmaa_contacts_template.xlsx");
    } catch {
      // Fallback to CSV if needed
      const csvContent =
        "data:text/csv;charset=utf-8," +
        "name,phone,email,company_name,job_title,source,lifecycle_stage\n" +
        "Ramesh Chandran,+91 98401 12345,ramesh@techcorp.com,TechCorp India,Director,Meta Ads,New\n" +
        "Sunita Sharma,+91 98123 77889,sunita@nexus.co,Nexus Solutions,VP Sales,Google Ads,Contacted\n" +
        "Vijay Raman,+91 97654 11223,vijay@apex.in,Apex Tech,Product Manager,Website Form,Qualified\n" +
        "Kavita Krishnan,+91 99887 44556,kavita@krishnan.org,Krishnan & Co,Founder,WhatsApp,Customer\n";
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "zigmaa_contacts_template.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleConfirmUpload = async () => {
    if (!parsedRows.length) return;
    setUploading(true);
    setError("");

    try {
      const res = await api.bulkUploadContacts(parsedRows);
      const skipMsg = res.duplicates_skipped > 0 ? ` (${res.duplicates_skipped} duplicates skipped)` : "";
      toast.success("Bulk Upload Complete", `Successfully imported ${res.total_ingested} contacts into Zigmaa CRM${skipMsg}.`);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to process bulk upload.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Excel / CSV Bulk Upload</h3>
              <p className="text-[11px] text-slate-500">Import multiple contacts at once into your CRM directory</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {/* Download Sample */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <p className="text-xs font-bold text-slate-800">Need the template format?</p>
              <p className="text-[11px] text-slate-500">Download the standard CSV template with sample contact fields.</p>
            </div>
            <button
              type="button"
              onClick={downloadSampleTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Download Template</span>
            </button>
          </div>

          {/* Drag & Drop Upload Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
              file
                ? "border-emerald-300 bg-emerald-50/40"
                : "border-slate-200 hover:border-red-300 hover:bg-slate-50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-xs font-bold text-slate-900 mb-1">
              {file ? file.name : "Click to browse or drag and drop Excel / CSV file"}
            </p>
            <p className="text-[11px] text-slate-400">
              Supports .csv, .xlsx, .xls (columns: name, phone, email, company, job_title, source, stage)
            </p>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Preview Table */}
          {previewRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  Preview ({parsedRows.length} total rows detected)
                </span>
                <span className="text-[11px] text-slate-400">Showing first 5 rows</span>
              </div>
              <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-48 text-[11px]">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                    <tr>
                      <th className="p-2">Name</th>
                      <th className="p-2">Phone</th>
                      <th className="p-2">Email</th>
                      <th className="p-2">Company</th>
                      <th className="p-2">Stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-600">
                    {previewRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-medium text-slate-900">{row.name || row.full_name || row["Contact Name"] || "—"}</td>
                        <td className="p-2 font-mono">{row.phone || row.mobile || row["Phone"] || "—"}</td>
                        <td className="p-2">{row.email || row["Email"] || "—"}</td>
                        <td className="p-2">{row.company_name || row.company || row["Company"] || "—"}</td>
                        <td className="p-2">{row.stage || row.lifecycle_stage || row.status || "New"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmUpload}
            disabled={!parsedRows.length || uploading}
            className="inline-flex items-center gap-1.5 px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Import {parsedRows.length ? `${parsedRows.length} Contacts` : ""}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
