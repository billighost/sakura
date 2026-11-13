"use client";
import {useEffect} from "react";
import {useReportWebVitals} from "next/web-vitals";
import {clientPerformance,installClientDiagnostics} from "./clientPerformance";
const report:Parameters<typeof useReportWebVitals>[0]=metric=>clientPerformance.record(metric.name,metric.value,"vital");
export function ClientDiagnostics(){useReportWebVitals(report);useEffect(installClientDiagnostics,[]);return null;}
