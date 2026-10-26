"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  X
} from "lucide-react";
import Papa from "papaparse";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import LogoLoader from "@/components/common/LogoLoader";
import { api } from "@/lib/api";

export default function BulkImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ total_ingested: number } | null>(null);
  const [error, setError] = useState("");

  const handleFileChange = (selectedFile: File) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setError("");
    setResult(null);

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          setParsedRows(results.data);
          setPreviewRows(results.data.slice(0, 5));
          setColumns(Object.keys(results.data[0] as object));
        } else {
          setError("The selected CSV file appears to be empty.");
        }
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
      }
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const downloadSampleCSV = () => {
    const csvContent =
      "data:text/csv;charset=utf-8," +
      "full_name,phone,email,company_name,source,stage,deal_value\n" +
      "Ramesh Chandran,+91 98401 12345,ramesh@techcorp.com,TechCorp India,Meta Ads,New Lead,120000\n" +
      "Sunita Sharma,+91 98123 77889,sunita@nexus.co,Nexus Solutions,Google Ads,Contacted / Follow-up,85000\n" +
      "Vijay Raman,+91 97654 11223,vijay@apex.in,Apex Tech,Website Form,Consultation Booked,210000\n" +
      "Kavita Krishnan,+91 99887 44556,kavita@krishnan.org,Krishnan & Co,Walk-in,Closed / Won,320000\n";

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "zigmaa_leads_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleConfirmUpload = async () => {
    if (!parsedRows.length) return;
    setUploading(true);

    try {
      const uploadRes = await api.bulkUploadLeads(parsedRows);
      setResult(uploadRes);
      setUploading(false);
    } catch (err: any) {
      setError(err.message || "Failed to process bulk ingestion.");
      setUploading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-900 font-sans overflow-hidden select-none">
      {uploading && <LogoLoader fullScreen text="Importing leads into Zigmaa CRM..." />}
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 custom-scrollbar">
          {/* Action Row */}
          <div className="flex items-center justify-end">
            <button
              onClick={downloadSampleCSV}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Download Sample Template</span>
            </button>
          </div>

          {/* Success Message */}
          {result && (
            <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-900">
                    Import Successful! {result.total_ingested} Leads Added
                  </h3>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Your new records have been added and all dashboard metrics have been updated.
                  </p>
                </div>
              </div>

              <Link
                href="/leads"
                className="flex items-center gap-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                <span>View Leads</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Dropzone */}
          {!parsedRows.length && !result && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => {
                const input = document.getElementById("csv-file-input") as HTMLInputElement;
                if (input) input.click();
              }}
              className="p-12 rounded-2xl border-2 border-dashed border-slate-300 hover:border-red-500 bg-white transition-all text-center flex flex-col items-center justify-center space-y-3 cursor-pointer shadow-xs"
            >
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />
              <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
                <Upload className="w-7 h-7" />
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Click to select CSV or drag and drop file here
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Supports standard CSV with name, phone, email, and company columns
                </p>
              </div>
            </div>
          )}

          {/* Preview Table */}
          {parsedRows.length > 0 && !result && (
            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    CSV Preview: {file?.name} ({parsedRows.length} rows detected)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Showing first 5 rows before committing ingestion
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setParsedRows([]);
                      setFile(null);
                    }}
                    className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 font-semibold"
                  >
                    Clear File
                  </button>
                  <button
                    onClick={handleConfirmUpload}
                    disabled={uploading}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Importing...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirm & Import {parsedRows.length} Leads</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px] bg-slate-50/50">
                      {columns.slice(0, 7).map((col) => (
                        <th key={col} className="py-2.5 px-3">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {previewRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        {columns.slice(0, 7).map((col) => (
                          <td key={col} className="py-2.5 px-3 text-slate-700">
                            {row[col] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
